import { PendingAuthDB, ActiveSessionDB } from "../database.js";
import { generateAuthCode, encrypt } from "../utils/crypto.js";
import { setDistributeKeyFn } from "../commands/auth.js";
import { setUpdateLimitFn }   from "../commands/setlimit.js";
import { setApplySecretFn }   from "../commands/secret.js";
import { setBroadcastFn }     from "../events/messageCreate.js";

/**
 * @param {import("socket.io").Server} io
 */
export function initSocketManager(io) {
  /** @type {Map<string, { count: number, windowStart: number }>} */
  const connectionAttempts = new Map();
  const WINDOW_MS = 60_000;
  const MAX_ATTEMPTS_PER_MIN = 30;

  // ── AES鍵・上限値の配布 ──────────────────────────
  setDistributeKeyFn((socketId, aesKey, maxComments) => {
    io.to(socketId).emit("auth_success", { key: aesKey, maxComments });
    console.log(`[manager] auth_success: socketId=${socketId} maxComments=${maxComments}`);
  });

  // ── 上限更新 ─────────────────────────────────────
  setUpdateLimitFn((socketId, maxComments) => {
    io.to(socketId).emit("update_limit", { maxComments });
    console.log(`[manager] update_limit: socketId=${socketId} maxComments=${maxComments}`);
  });

  // ── セッションエフェクト適用 ──────────────────────
  // channelId を監視している全セッションに apply_secret を送信
  setApplySecretFn((channelId, effect, value) => {
    const sessions = ActiveSessionDB.findByChannelId(channelId);
    for (const session of sessions) {
      io.to(session.socket_id).emit("apply_secret", { effect, value });
      console.log(`[manager] apply_secret: socketId=${session.socket_id} effect=${effect} value=${value}`);
    }
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
    console.log(`[manager] 接続試行: socketId=${socket.id}`);

    const ip = socket.handshake.address || "unknown";
    const now = Date.now();
    const ipAttempt = connectionAttempts.get(ip) ?? { count: 0, windowStart: now };
    if (now - ipAttempt.windowStart >= WINDOW_MS) {
      ipAttempt.count = 0;
      ipAttempt.windowStart = now;
    }
    ipAttempt.count += 1;
    connectionAttempts.set(ip, ipAttempt);

    if (ipAttempt.count > MAX_ATTEMPTS_PER_MIN) {
      socket.emit("error_msg", { code: "RATE_LIMIT", message: "接続試行回数が多すぎます。しばらく待って再試行してください" });
      socket.disconnect(true);
      return;
    }

    const token = socket.handshake.query.token;
    const isValidTokenFormat = typeof token === "string" && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(token);

    if (!isValidTokenFormat) {
      socket.emit("error_msg", { code: "INVALID_TOKEN_FORMAT", message: "トークン形式が不正です" });
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
    console.log(`[manager] 接続確立: socketId=${socket.id}`);

    function sendAuthCode() {
      const isAuthenticated = !!ActiveSessionDB.findBySocketId(socket.id);
      if (isAuthenticated) return;
      socket.emit("auth_code", { code });
      console.log(`[manager] auth_code 送信: socketId=${socket.id}`);
    }

    socket.on("client_ready", () => {
      console.log(`[manager] client_ready: socketId=${socket.id}`);
      sendAuthCode();
    });

    socket.on("request_code", () => {
      console.log(`[manager] request_code: socketId=${socket.id}`);
      sendAuthCode();
    });

    socket.on("disconnect", async (reason) => {
      console.log(`[manager] 切断: socketId=${socket.id} reason=${reason}`);
      await Promise.all([
        PendingAuthDB.removeBySocketId(socket.id),
        ActiveSessionDB.removeBySocketId(socket.id),
      ]);
    });
  });
}
