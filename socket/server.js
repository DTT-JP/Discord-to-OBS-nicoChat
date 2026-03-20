import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
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
  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout:       20_000,
    pingInterval:      10_000,
    // pollingからwebsocketへのアップグレードを即座に行う
    upgradeTimeout:    5_000,
    // httpポーリングの最大待機時間を短縮して遅延を抑える
    allowUpgrades:     true,
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