import { PendingAuthDB, ActiveSessionDB } from "../database.js";
import { generateAuthCode, encrypt } from "../utils/crypto.js";
import { setDistributeKeyFn } from "../commands/auth.js";
import { setUpdateLimitFn }   from "../commands/setlimit.js";
import { setBroadcastFn }     from "../events/messageCreate.js";

/**
 * @param {import("socket.io").Server} io
 */
export function initSocketManager(io) {

  // ── AES鍵・上限値の配布 ──────────────────────────
  setDistributeKeyFn((socketId, aesKey, maxComments) => {
    io.to(socketId).emit("auth_success", { key: aesKey, maxComments });
    console.log(`[manager] auth_success 送信: socketId=${socketId} maxComments=${maxComments}`);
  });

  // ── 上限更新 ─────────────────────────────────────
  setUpdateLimitFn((socketId, maxComments) => {
    io.to(socketId).emit("update_limit", { maxComments });
    console.log(`[manager] update_limit 送信: socketId=${socketId} maxComments=${maxComments}`);
  });

  // ── ブロードキャスト ──────────────────────────────
  setBroadcastFn((channelId, payload) => {
    const sessions = ActiveSessionDB.findByChannelId(channelId);
    for (const session of sessions) {
      try {
        const encrypted = encrypt(JSON.stringify(payload), session.aes_key);
        io.to(session.socket_id).emit("message", encrypted);
      } catch (err) {
        console.error(`[manager] 暗号化エラー: socketId=${session.socket_id}`, err);
      }
    }
  });

  // ── 接続イベント ──────────────────────────────────
  io.on("connection", async (socket) => {
    console.log(`[manager] 新規接続試行: socketId=${socket.id}`);

    const token = socket.handshake.query.token;

    // トークン未指定
    if (typeof token !== "string" || !token) {
      console.warn(`[manager] トークンなし: socketId=${socket.id}`);
      socket.emit("error_msg", { code: "NO_TOKEN", message: "トークンが指定されていません" });
      socket.disconnect(true);
      return;
    }

    // DB検索
    const pending = PendingAuthDB.findByToken(token);
    if (!pending) {
      console.warn(`[manager] 無効トークン: token=${token}`);
      socket.emit("error_msg", { code: "INVALID_TOKEN", message: "無効なトークンです" });
      socket.disconnect(true);
      return;
    }

    // 有効期限
    if (Date.now() > pending.expires_at) {
      console.warn(`[manager] 期限切れトークン: token=${token}`);
      await PendingAuthDB.removeByToken(token);
      socket.emit("error_msg", {
        code:    "TOKEN_EXPIRED",
        message: "トークンの有効期限が切れています。/start からやり直してください",
      });
      socket.disconnect(true);
      return;
    }

    // コード生成・DB更新
    const code = generateAuthCode();
    await PendingAuthDB.updateSocketAndCode(token, socket.id, code);
    console.log(`[manager] 接続確立・コード生成: socketId=${socket.id} code=${code}`);

    // コード送信関数（重複送信防止）
    function sendAuthCode() {
      // 既に認証済みなら送らない
      const isAuthenticated = !!ActiveSessionDB.findBySocketId(socket.id);
      if (isAuthenticated) {
        console.log(`[manager] 認証済みのためスキップ: socketId=${socket.id}`);
        return;
      }
      console.log(`[manager] auth_code 送信: socketId=${socket.id} code=${code}`);
      socket.emit("auth_code", { code });
    }

    // client_ready を受信したらコードを送信
    socket.on("client_ready", () => {
      console.log(`[manager] client_ready 受信: socketId=${socket.id}`);
      sendAuthCode();
    });

    // 再要求にも対応
    socket.on("request_code", () => {
      console.log(`[manager] request_code 受信: socketId=${socket.id}`);
      sendAuthCode();
    });

    // 切断処理
    socket.on("disconnect", async (reason) => {
      console.log(`[manager] 切断: socketId=${socket.id} reason=${reason}`);
      await Promise.all([
        PendingAuthDB.removeBySocketId(socket.id),
        ActiveSessionDB.removeBySocketId(socket.id),
      ]);
    });
  });
}