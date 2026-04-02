import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  Options,
  LimitedCollection,
} from "discord.js";
import { createSocketServer } from "./socket/server.js";
import { initSocketManager } from "./socket/manager.js";
import { ActiveSessionDB, PendingAuthDB } from "./database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
// 環境変数バリデーション
// ─────────────────────────────────────────────

const REQUIRED_ENV = ["DISCORD_TOKEN", "CLIENT_ID", "PORT", "HOST"];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[init] 環境変数 ${key} が設定されていません`);
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT);

// ─────────────────────────────────────────────
// Discord クライアント初期化
// キャッシュ上限・自動掃除でメモリ使用量を抑制する
// ─────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,   // メッセージ本文の取得に必要
    GatewayIntentBits.GuildMembers,     // displayName・ロール取得に必要
    GatewayIntentBits.DirectMessages,   // DM送信に必要
  ],
  partials: [
    Partials.Channel,   // DM チャンネルの受信に必要
    Partials.Message,
  ],

  // ── キャッシュ上限設定 ──────────────────────
  // 無制限キャッシュによるメモリ増大を防ぐ
  makeCache: Options.cacheWithLimits({
    // メッセージキャッシュ: チャンネルあたり最大50件
    MessageManager:      50,
    // ユーザーキャッシュ: 最大200件（DM相手など）
    UserManager:        200,
    // その他は最小限に抑える
    GuildMemberManager: 200,
    // スラッシュコマンドに不要なキャッシュを無効化
    GuildEmojiManager:    0,
    GuildStickerManager:  0,
    GuildInviteManager:   0,
    PresenceManager:      0,
    ReactionManager:      0,
    StageInstanceManager: 0,
    ThreadManager:        0,
    VoiceStateManager:    0,
  }),

  // ── 自動スウィーパー設定 ────────────────────
  // 定期的にキャッシュを掃除してメモリを解放する
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: {
      // 5分ごとにスウィープ
      interval: 300,
      // 1時間以上経過したメッセージを削除
      lifetime: 3600,
    },
    users: {
      // 5分ごとにスウィープ
      interval: 300,
      // Botのユーザーオブジェクト自身は残す
      filter: () => (user) => user.id !== client.user?.id,
    },
    guildMembers: {
      interval: 300,
      // Botメンバー自身は残す
      filter: () => (member) => member.id !== client.user?.id,
    },
  },
});

// コマンドを格納する Map を client に付与
client.commands = new Collection();

// ─────────────────────────────────────────────
// コマンドの動的ロード
// ─────────────────────────────────────────────

const commandsPath = join(__dirname, "commands");
const commandFiles = readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

for (const file of commandFiles) {
  const fileUrl = pathToFileURL(join(commandsPath, file)).href;
  const mod     = await import(fileUrl);

  if (!mod.data?.name || typeof mod.execute !== "function") {
    console.warn(`[init] スキップ: ${file} に data.name または execute が見つかりません`);
    continue;
  }

  client.commands.set(mod.data.name, mod);
  console.log(`[init] コマンドロード: /${mod.data.name}`);
}

// ─────────────────────────────────────────────
// イベントの動的ロード
// ─────────────────────────────────────────────

const eventsPath = join(__dirname, "events");
const eventFiles = readdirSync(eventsPath).filter((f) => f.endsWith(".js"));

for (const file of eventFiles) {
  const fileUrl = pathToFileURL(join(eventsPath, file)).href;
  const mod     = await import(fileUrl);

  if (!mod.name || typeof mod.execute !== "function") {
    console.warn(`[init] スキップ: ${file} に name または execute が見つかりません`);
    continue;
  }

  // execute に client を第2引数として渡す共通ラッパー
  const handler = (...args) => mod.execute(...args, client);

  if (mod.once) {
    client.once(mod.name, handler);
  } else {
    client.on(mod.name, handler);
  }

  console.log(`[init] イベントロード: ${mod.name} (once=${!!mod.once})`);
}

// ─────────────────────────────────────────────
// Express / Socket.io サーバー起動
// ─────────────────────────────────────────────

const { httpServer, io } = createSocketServer();

// Socket Manager を初期化（関数注入はここで確定する）
initSocketManager(io);

await new Promise((resolve, reject) => {
  httpServer.listen(PORT, (err) => {
    if (err) return reject(err);
    resolve();
  });
});

console.log(`[init] HTTP/Socket.io サーバー起動: http://${process.env.HOST}:${PORT}`);

// ─────────────────────────────────────────────
// Discord Bot ログイン
// ─────────────────────────────────────────────

await client.login(process.env.DISCORD_TOKEN);

// ─────────────────────────────────────────────
// 期限切れ pending_auth の定期クリーンアップ
// ─────────────────────────────────────────────

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5分ごと

const cleanupTimer = setInterval(async () => {
  await PendingAuthDB.removeExpired();
  console.log(`[cleanup] 期限切れ pending_auth を削除しました`);
}, CLEANUP_INTERVAL_MS);

// タイマーが Node.js プロセスの終了を妨げないようにする
cleanupTimer.unref();

// ─────────────────────────────────────────────
// グレースフルシャットダウン
// ─────────────────────────────────────────────

/**
 * プロセス終了時の共通クリーンアップ処理
 * @param {string} signal
 */
async function shutdown(signal) {
  console.log(`\n[shutdown] ${signal} を受信しました。クリーンアップを開始します...`);

  // タイマー停止
  clearInterval(cleanupTimer);

  try {
    // 1. 全アクティブセッションを DB から削除
    await ActiveSessionDB.removeAll();
    console.log("[shutdown] アクティブセッションを全削除しました");

    // 2. 全 pending_auth を削除
    await PendingAuthDB.removeExpired();
    console.log("[shutdown] 期限切れ pending_auth を削除しました");

    // 3. Socket.io の全接続を切断
    await new Promise((resolve) => {
      io.close(resolve);
    });
    console.log("[shutdown] Socket.io サーバーを停止しました");

    // 4. HTTP サーバーを停止
    await new Promise((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    console.log("[shutdown] HTTP サーバーを停止しました");

    // 5. Discord Bot をログアウト
    await client.destroy();
    console.log("[shutdown] Discord Bot をログアウトしました");

    console.log("[shutdown] クリーンアップ完了。プロセスを終了します");
    process.exit(0);

  } catch (err) {
    console.error("[shutdown] クリーンアップ中にエラーが発生しました:", err);
    process.exit(1);
  }
}

// SIGINT (Ctrl+C) / SIGTERM (systemd stop など) を捕捉
process.once("SIGINT",  () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

// 未処理の例外・Promise 拒否をログに残してプロセスを維持
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
