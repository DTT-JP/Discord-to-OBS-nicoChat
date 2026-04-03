import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "../public");

/**
 * Express + Socket.io サーバーを構築して返す
 * @returns {{ app: express.Application, httpServer: import("node:http").Server, io: Server }}
 */
export function createSocketServer() {
  const app        = express();
  const httpServer = createServer(app);

  // ── セキュリティヘッダ（helmet: nosniff・X-Frame-Options 等） ──
  // OBS オーバーレイは同一オリジンの script / インライン style / Discord CDN 画像を許可
  app.use(
    helmet({
      strictTransportSecurity: false,
      referrerPolicy:          { policy: "no-referrer" },
      frameguard:              { action: "deny" },
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc:  ["'self'"],
          styleSrc:   ["'self'", "'unsafe-inline'"],
          imgSrc:     ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"],
          baseUri:    ["'self'"],
        },
      },
    }),
  );

  // ── CORS設定 ──────────────────────────────────
  // ALLOWED_ORIGINS に許可するオリジンをカンマ区切りで設定する（例: https://example.com,https://obs.example.com）
  // 未設定の場合は !origin（OBSブラウザソースなど）のみ許可する
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : [];

  const isLocalOrigin = (origin) => {
    try {
      const { hostname } = new URL(origin);
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    } catch {
      return false;
    }
  };

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // OBSブラウザソースは origin が null/undefined になるため許可
        if (!origin) {
          return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        // ローカル開発時は ALLOWED_ORIGINS 未設定でも localhost 系を許可
        if (allowedOrigins.length === 0 && isLocalOrigin(origin)) {
          return callback(null, true);
        }

        console.warn(`[CORS] Blocked: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      },
      methods:     ["GET", "POST"],
      credentials: true,
    },
    pingTimeout:    20_000,
    pingInterval:   10_000,
    upgradeTimeout:  5_000,
    allowUpgrades:  true,
  });

  // ── 静的ファイル配信 ──────────────────────────
  app.use(express.static(PUBLIC_DIR));

  // ── ヘルスチェック ────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // ── SPA フォールバック（全パスを index.html へ） ──
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, "index.html"));
  });

  return { app, httpServer, io };
}
