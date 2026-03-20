import { PendingAuthDB, ActiveSessionDB } from "../database.js";
import { generateAuthCode, encrypt } from "../utils/crypto.js";
import { setDistributeKeyFn } from "../commands/auth.js";
import { setUpdateLimitFn }   from "../commands/setlimit.js";
import { setBroadcastFn }     from "../events/messageCreate.js";

/**
 * @param {import("socket.io").Server} io
 */
export function initSocketManager(io) {

  // ── AES鍵・上限値の配布関数を auth.js へ注入 ────
  setDistributeKeyFn((socketId, aesKey, maxComments) => {
    io.to(socketId).emit("auth_success", { key: aesKey, maxComments });
    console.log(`[manager] AES鍵配布: socketId=${socketId} maxComments=${maxComments}`);
  });

  // ── 上限更新関数を setlimit.js へ注入 ───────────
  setUpdateLimitFn((socketId, maxComments) => {
    io.to(socketId).emit("update_limit", { maxComments });
    console.log(`[manager] 上限更新: socketId=${socketId} maxComments=${maxComments}`);
  });

  // ── ブロードキャスト関数を messageCreate.js へ注入 ──
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

  // ── Socket.io 接続イベント ─────────────────────
  io.on("connection", async (socket) => {
    const token = socket.handshake.query.token;

    if (typeof token !== "string" || !token) {
      socket.emit("error_msg", { code: "NO_TOKEN", message: "トークンが指定されていません" });
      socket.disconnect(true);
      return;
    }

    const pending = PendingAuthDB.findByToken(token);
    if (!pending) {
      socket.emit("error_msg", { code: "INVALID_TOKEN", message: "無効なトークンです" });
      socket.disconnect(true);
      return;
    }

    if (Date.now() > pending.expires_at) {
      await PendingAuthDB.removeByToken(token);
      socket.emit("error_msg", {
        code:    "TOKEN_EXPIRED",
        message: "トークンの有効期限が切れています。/start からやり直してください",
      });
      socket.disconnect(true);
      return;
    }

    const code = generateAuthCode();
    await PendingAuthDB.updateSocketAndCode(token, socket.id, code);
    console.log(`[manager] 接続確立: socketId=${socket.id}, code=${code}`);

    function sendAuthCode() {
      const isAuthenticated = !!ActiveSessionDB.findBySocketId(socket.id);
      if (isAuthenticated) return;
      socket.emit("auth_code", { code });
      console.log(`[manager] auth_code 送信: socketId=${socket.id}, code=${code}`);
    }

    socket.on("client_ready",  () => {
      console.log(`[manager] client_ready: socketId=${socket.id}`);
      sendAuthCode();
    });

    socket.on("request_code",  () => {
      console.log(`[manager] request_code: socketId=${socket.id}`);
      sendAuthCode();
    });

    socket.on("disconnect", async (reason) => {
      console.log(`[manager] 切断: socketId=${socket.id}, reason=${reason}`);
      await Promise.all([
        PendingAuthDB.removeBySocketId(socket.id),
        ActiveSessionDB.removeBySocketId(socket.id),
      ]);
    });
  });
}