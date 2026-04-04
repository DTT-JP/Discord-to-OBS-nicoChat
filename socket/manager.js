import { PendingAuthDB, ActiveSessionDB } from "../database.js";
import { generateAuthCode, encrypt } from "../utils/crypto.js";
import { maskSecrets } from "../utils/logSafe.js";
import { setDistributeKeyFn } from "../commands/auth.js";
import { setUpdateLimitFn }   from "../commands/session.js";
import { setApplySecretFn }   from "../commands/secret.js";
import { setBroadcastFn }     from "../events/messageCreate.js";

let shuttingDown = false;

/** PM2 graceful reload 時: disconnect ハンドラで DB 行を消さない */
export function setSocketShuttingDown(value) {
  shuttingDown = !!value;
}

const RESUME_HEX_RE = /^[0-9a-fA-F]{64}$/;
const MAX_COMMENTS_MIN = 1;
const MAX_COMMENTS_MAX = 99999;
const DEFAULT_MAX_COMMENTS = 30;

/**
 * @param {unknown} v
 * @returns {number}
 */
function clampMaxComments(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_MAX_COMMENTS;
  const t = Math.trunc(n);
  if (t < MAX_COMMENTS_MIN) return DEFAULT_MAX_COMMENTS;
  return Math.min(MAX_COMMENTS_MAX, t);
}

/**
 * リバースプロキシ (nginx / Cloudflare 等) 経由の場合に実クライアント IP を取得する。
 * X-Forwarded-For の先頭エントリを優先し、取得できない場合は socket の直接アドレスへ
 * フォールバックする。
 *
 * ⚠️ 信頼できるプロキシからのみ X-Forwarded-For を受け入れる前提。
 * 公開環境では nginx / Cloudflare 側で偽装ヘッダを除去することを推奨。
 *
 * @param {import("socket.io").Socket} socket
 * @returns {string}
 */
function getClientIp(socket) {
  const xff = socket.handshake.headers["x-forwarded-for"];
  if (xff) {
    // "client, proxy1, proxy2" 形式 → 先頭がオリジンIP
    const first = (typeof xff === "string" ? xff : xff[0]).split(",")[0].trim();
    if (first) return first;
  }
  return socket.handshake.address || "unknown";
}

/**
 * @param {import("socket.io").Server} io
 */
export function initSocketManager(io) {
  /** @type {Map<string, { count: number, windowStart: number }>} */
  const connectionAttempts = new Map();
  const WINDOW_MS = 60_000;
  const MAX_ATTEMPTS_PER_MIN = 30;
  const ATTEMPT_SWEEP_INTERVAL_MS = 2 * WINDOW_MS;

  const attemptSweeper = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of connectionAttempts) {
      if (!rec || now - rec.windowStart > ATTEMPT_SWEEP_INTERVAL_MS) {
        connectionAttempts.delete(ip);
      }
    }
  }, ATTEMPT_SWEEP_INTERVAL_MS);
  attemptSweeper.unref();

  // ── AES鍵・上限値の配布 ──────────────────────────
  setDistributeKeyFn((socketId, aesKey, maxComments, resumeToken) => {
    const safeMaxComments = clampMaxComments(maxComments);
    io.to(socketId).emit("auth_success", { key: aesKey, maxComments: safeMaxComments, resumeToken });
    console.log(`[manager] auth_success: socketId=${socketId} maxComments=${safeMaxComments}`);
  });

  // ── 上限更新 ─────────────────────────────────────
  setUpdateLimitFn((socketId, maxComments) => {
    const safeMaxComments = clampMaxComments(maxComments);
    io.to(socketId).emit("update_limit", { maxComments: safeMaxComments });
    console.log(`[manager] update_limit: socketId=${socketId} maxComments=${safeMaxComments}`);
  });

  // ── セッションエフェクト適用 ──────────────────────
  setApplySecretFn((socketIds, effect, value) => {
    for (const socketId of socketIds) {
      io.to(socketId).emit("apply_secret", { effect, value });
      console.log(`[manager] apply_secret: socketId=${socketId} effect=${effect} value=${value}`);
    }
  });

  // ── ブロードキャスト ──────────────────────────────
  setBroadcastFn((channelId, payload) => {
    const sessions = ActiveSessionDB.findByChannelId(channelId);
    for (const session of sessions) {
      if (!session.socket_id) continue;
      try {
        const encrypted = encrypt(JSON.stringify(payload), session.aes_key);
        io.to(session.socket_id).emit("message", encrypted);
      } catch (err) {
        const safe = err instanceof Error ? maskSecrets(err.message) : err;
        console.error(`[manager] 暗号化エラー: socketId=${session.socket_id}`, safe);
      }
    }
  });

  // ── 接続イベント ──────────────────────────────────
  io.on("connection", async (socket) => {
    console.log(`[manager] 接続試行: socketId=${socket.id}`);

    // リバースプロキシを考慮したクライアントIP取得
    const ip = getClientIp(socket);
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

    const resume = socket.handshake.query.resume;
    if (typeof resume === "string" && RESUME_HEX_RE.test(resume)) {
      const session = ActiveSessionDB.findByResumeToken(resume);
      if (!session) {
        socket.emit("error_msg", { code: "INVALID_RESUME", message: "セッションの再開に失敗しました。/start からやり直してください。" });
        socket.disconnect(true);
        return;
      }
      if (session.socket_id) {
        const existing = io.sockets.sockets.get(session.socket_id);
        if (existing && existing.connected && session.socket_id !== socket.id) {
          socket.emit("error_msg", {
            code:    "SESSION_IN_USE",
            message: "このオーバーレイは別の接続で開かれています。元の OBS ブラウザを閉じてから再試行してください。",
          });
          socket.disconnect(true);
          return;
        }
      }
      await ActiveSessionDB.updateSocketIdByTokenHash(session.token_hash, socket.id);
      io.to(socket.id).emit("auth_success", {
        key:          session.aes_key,
        maxComments:  clampMaxComments(session.max_comments),
        resumeToken:  resume,
      });
      console.log(`[manager] セッション再開: socketId=${socket.id}`);

      socket.on("disconnect", async (reason) => {
        console.log(`[manager] 切断: socketId=${socket.id} reason=${reason}`);
        if (shuttingDown) return;
        await ActiveSessionDB.clearSocketIdBySocketId(socket.id);
      });
      return;
    }

    const token = socket.handshake.query.token;
    const isValidTokenFormat = typeof token === "string"
      && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(token);

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

    if (pending.socket_id) {
      const existing = io.sockets.sockets.get(pending.socket_id);
      if (existing && existing.connected && pending.socket_id !== socket.id) {
        socket.emit("error_msg", {
          code:    "TOKEN_IN_USE",
          message: "この URL は既に別のブラウザで接続されています。元のタブを閉じるか、/start で新しい URL を発行してください。",
        });
        socket.disconnect(true);
        return;
      }
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
      if (shuttingDown) return;
      await Promise.all([
        PendingAuthDB.removeBySocketId(socket.id),
        ActiveSessionDB.clearSocketIdBySocketId(socket.id),
      ]);
    });
  });
}
