import { REST, Routes } from "discord.js";
import { readdirSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "dotenv/config";
import { sanitizeCommandNode } from "./utils/sanitizeCommand.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("[deploy] .env に DISCORD_TOKEN / CLIENT_ID / GUILD_ID が必要です");
  process.exit(1);
}

// commands/ 配下の .js ファイルを全走査
const commandsPath = join(__dirname, "commands");
const commandFiles = readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

const jsonCommands = [];

for (const file of commandFiles) {
  const filePath = join(commandsPath, file);
  const fileUrl  = pathToFileURL(filePath).href;

  /** @type {{ data: import("discord.js").SlashCommandBuilder }} */
  const mod = await import(fileUrl);

  if (!mod.data?.toJSON) {
    console.warn(`[deploy] スキップ: ${file} に data が見つかりません`);
    continue;
  }

  jsonCommands.push(sanitizeCommandNode(mod.data.toJSON()));
  console.log(`[deploy] 読み込み: /${mod.data.name}`);
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

console.log(`[deploy] ${jsonCommands.length} 件のスラッシュコマンドを登録中...`);

const result = await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: jsonCommands },
);

console.log(`[deploy] 完了: ${result.length} 件のコマンドを登録しました`);
