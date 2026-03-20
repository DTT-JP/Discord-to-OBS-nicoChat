import { REST, Routes } from "discord.js";
import { readdirSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

const { DISCORD_TOKEN, CLIENT_ID } = process.env; // GUILD_ID を削除

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("[deploy] .env に DISCORD_TOKEN / CLIENT_ID が必要です");
  process.exit(1);
}

const commandsPath = join(__dirname, "commands");
const commandFiles = readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

const jsonCommands = [];

for (const file of commandFiles) {
  const fileUrl = pathToFileURL(join(commandsPath, file)).href;
  const mod     = await import(fileUrl);

  if (!mod.data?.toJSON) {
    console.warn(`[deploy] スキップ: ${file} に data が見つかりません`);
    continue;
  }

  jsonCommands.push(mod.data.toJSON());
  console.log(`[deploy] 読み込み: /${mod.data.name}`);
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

console.log(`[deploy] ${jsonCommands.length} 件のスラッシュコマンドをグローバル登録中...`);
console.log("[deploy] ⚠️  グローバルコマンドの反映には最大1時間かかります");

const result = await rest.put(
  Routes.applicationCommands(CLIENT_ID), // ← GUILD_ID を外してグローバル化
  { body: jsonCommands },
);

console.log(`[deploy] 完了: ${result.length} 件のコマンドをグローバル登録しました`);