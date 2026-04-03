import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { GlobalBlacklistDB } from "../database.js";
import {
  parseTargetUser,
  formatRemaining,
  formatDateTime,
  formatUserTagForReply,
} from "../utils/moderation.js";
import { parseDurationValueAndUnit } from "../utils/blacklistDuration.js";
import { ListScope, replyPaginatedList } from "../utils/paginatedList.js";

function isBotOwner(interaction) {
  const ownerId = process.env.BOT_OWNER_ID?.trim();
  return ownerId && interaction.user.id === ownerId;
}

export const data = new SlashCommandBuilder()
  .setName("global_blacklist")
  .setDescription("グローバルブラックリストを管理します")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("ユーザーをグローバルブラックリストに追加")
      .addStringOption((opt) => opt.setName("reason").setDescription("理由").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("duration_value").setDescription("期間の数値／無制限は infinity").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("duration_unit")
          .setDescription("単位（無制限は両方 infinity）")
          .setRequired(true)
          .addChoices(
            { name: "分", value: "minute" },
            { name: "時間", value: "hour" },
            { name: "日", value: "day" },
            { name: "週", value: "week" },
            { name: "月(30日)", value: "month" },
            { name: "年", value: "year" },
            { name: "無制限（値も infinity）", value: "infinity" },
          ),
      )
      .addUserOption((opt) =>
        opt.setName("user").setDescription("対象（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("対象のユーザーID（どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("ユーザーをグローバルブラックリストから削除")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("対象（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("対象のユーザーID（どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("グローバルブラックリストを表示（10件/ページ）")
      .addIntegerOption((opt) =>
        opt.setName("page").setDescription("表示するページ（1から）").setMinValue(1).setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("特定ユーザーの詳細情報を表示")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("対象（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("対象のユーザーID（どちらか必須）").setRequired(false),
      ),
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (!process.env.BOT_OWNER_ID?.trim()) {
    return interaction.reply({ content: "❌ `BOT_OWNER_ID` が `.env` に設定されていません。", flags: MessageFlags.Ephemeral });
  }
  if (!isBotOwner(interaction)) {
    return interaction.reply({ content: "❌ このコマンドはBot製作者のみ実行できます。", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === "add") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });

    const reason = interaction.options.getString("reason", true);
    const dur = parseDurationValueAndUnit(interaction);
    if (dur.error) return interaction.editReply({ content: dur.error });
    const expiresAt = dur.expiresAt;
    const added = await GlobalBlacklistDB.add(
      target.userId,
      interaction.user.id,
      reason,
      expiresAt,
      interaction.guildId ?? "DM",
    );
    const label = await formatUserTagForReply(interaction.client, target);
    if (!added) return interaction.editReply({ content: `⚠️ **${label}** はすでに登録されています。` });

    return interaction.editReply({
      content: [
        `🚫 **${label}**（<@${target.userId}>）をグローバルブラックリストに追加しました。`,
        `理由: ${reason}`,
        `残り期間: ${formatRemaining(expiresAt)}`,
      ].join("\n"),
    });
  }

  if (sub === "remove") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });
    const label = await formatUserTagForReply(interaction.client, target);
    const removed = await GlobalBlacklistDB.remove(target.userId);
    if (!removed) return interaction.editReply({ content: `⚠️ **${label}** は登録されていません。` });
    return interaction.editReply({ content: `✅ **${label}** をグローバルブラックリストから削除しました。` });
  }

  if (sub === "list") {
    return replyPaginatedList(interaction, ListScope.GLOBAL_BL, "global");
  }

  const target = parseTargetUser(interaction);
  if (target.error) return interaction.editReply({ content: target.error });

  const entry = GlobalBlacklistDB.find(target.userId);
  if (!entry) {
    return interaction.editReply({
      content: `ℹ️ \`${target.userId}\` はグローバルブラックリストに登録されていません。`,
    });
  }

  const displayUser = target.user ?? (await interaction.client.users.fetch(target.userId).catch(() => null));
  const nameLine = displayUser?.tag ?? `(API未取得) \`${target.userId}\``;

  const guildText = entry.added_in_guild_id === "DM" ? "DM" : `<#${entry.added_in_guild_id}> / \`${entry.added_in_guild_id}\``;
  const embed = new EmbedBuilder()
    .setTitle("🔎 global_blacklist_show")
    .setColor(0xed4245)
    .addFields(
      { name: "ユーザーID", value: entry.user_id, inline: true },
      { name: "名前", value: nameLine, inline: true },
      { name: "施行日時", value: formatDateTime(entry.added_at), inline: true },
      { name: "どこのサーバー", value: guildText, inline: false },
      { name: "理由", value: entry.reason || "(理由なし)", inline: false },
      { name: "残り期限", value: formatRemaining(entry.expires_at), inline: true },
      { name: "設定期限", value: formatDateTime(entry.expires_at), inline: true },
    )
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
