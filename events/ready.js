import { Events } from "discord.js";

export const name    = Events.ClientReady;
export const once   = true;

/**
 * @param {import("discord.js").Client} client
 */
export async function execute(client) {
  console.log(`[ready] ${client.user.tag} としてログインしました`);
  console.log(`[ready] 参加サーバー数: ${client.guilds.cache.size}`);

  // Bot のステータスを設定
  client.user.setPresence({
    activities: [{ name: "/help でコマンド一覧" }],
    status: "online",
  });
}