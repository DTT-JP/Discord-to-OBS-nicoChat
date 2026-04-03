import { Events, EmbedBuilder } from "discord.js";
import { GlobalGuildBlacklistDB } from "../database.js";
import { formatDateTime } from "../utils/moderation.js";

function buildDmEmbed(guildName, entry) {
  const appealUrl = process.env.GLOBAL_GUILD_BLACKLIST_APPEAL_URL?.trim();
  const appealLine = appealUrl ? appealUrl : "未設定";
  const reasonPublic = entry.public_reason?.trim() ? entry.public_reason.trim() : "（理由なし）";
  const expiresText = entry.expires_at == null ? "無期限" : formatDateTime(entry.expires_at);
  const embed = new EmbedBuilder()
    .setTitle("🚫 このサーバーでは使えません")
    .setColor(0xed4245)
    .addFields(
      { name: "退出先ギルド", value: guildName, inline: false },
      { name: "理由", value: reasonPublic, inline: false },
      { name: "期限", value: expiresText, inline: false },
      {
        name: "異議申し立て",
        value: appealLine === "未設定" ? "未設定" : `[\u7570\u8b70\u7533\u8a33](${appealLine})`,
        inline: false,
      },
    )
    .setTimestamp();

  // embed だけだとメッセージ本文が空になる場合があるため、短い本文も添える
  return embed;
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

  const dmEmbed = buildDmEmbed(guild.name, entry);
  await owner.send({ embeds: [dmEmbed] }).catch(() => {});

  // 退出後も処理を止めない（エラーは握りつぶし）
}

