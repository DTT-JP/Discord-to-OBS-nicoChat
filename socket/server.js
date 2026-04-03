import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";
import { resolveCorsConfigForSocketIo, isLocalDevOrigin } from "../utils/corsPolicy.js";

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
  const publicUrl = (process.env.PUBLIC_URL || "").trim().toLowerCase();
  const enableHsts =
    publicUrl.startsWith("https://") || (process.env.ENABLE_HSTS || "").trim() === "1";

  app.use(
    helmet({
      strictTransportSecurity: enableHsts ? {} : false,
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

  // ── CORS（詳細は utils/corsPolicy.js および docs/ALLOWED_ORIGINS.md） ──
  const corsCfg = resolveCorsConfigForSocketIo();

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) {
          if (corsCfg.allowNullOrigin) {
            return callback(null, true);
          }
          console.warn("[CORS] Origin ヘッダ無し接続を拒否しました（ALLOW_NULL_ORIGIN を確認）");
          return callback(new Error("Not allowed by CORS"));
        }

        if (corsCfg.allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        if (corsCfg.allowLocalhostFallback && isLocalDevOrigin(origin)) {
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
