import { Events } from "discord.js";
import { GlobalGuildBlacklistDB } from "../database.js";
import { formatDateTime } from "../utils/moderation.js";

function buildDm(guildName, entry) {
  const appealUrl = process.env.GLOBAL_GUILD_BLACKLIST_APPEAL_URL?.trim();
  const appealLine = appealUrl ? `異議申し立てはこちら: ${appealUrl}` : "異議申し立てはこちら: (URL未設定)";
  const reasonPublic = entry.public_reason?.trim() ? entry.public_reason.trim() : "（理由なし）";
  return [
    "このサーバーではこのBOTは使えません。",
    `このBOTはサーバー（${guildName}）から退出しました。`,
    `理由（公開向け）: ${reasonPublic}`,
    `期限: 解除される日時（${formatDateTime(entry.expires_at)}）`,
    appealLine,
  ].join("\n");
}

export const name = Events.GuildCreate;
export const once = false;

/**
 * @param {import("discord.js").Guild} guild
 * @param {import("discord.js").Client} client
 */
export async function execute(guild, client) {
  const entry = GlobalGuildBlacklistDB.find(guild.id);
  if (!entry) return;

  const ownerId = guild.ownerId;
  if (!ownerId) return;

  const owner = await client.users.fetch(ownerId).catch(() => null);
  if (!owner) return;

  // 退出を先に行う（DM文面の「退出しました」との時間差を小さくする）
  await guild.leave().catch(() => {});

  const dm = buildDm(guild.name, entry);
  await owner.send(dm).catch(() => {});

  // 退出後も処理を止めない（エラーは握りつぶし）
}

