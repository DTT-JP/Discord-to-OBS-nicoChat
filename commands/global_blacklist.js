import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { GlobalBlacklistDB } from "../database.js";
import {
  parseTargetUser,
  computeExpireAt,
  formatRemaining,
  truncateReason,
  formatDateTime,
} from "../utils/moderation.js";

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
        opt.setName("duration_type").setDescription("期間種別").setRequired(true)
          .addChoices(
            { name: "分", value: "minute" },
            { name: "時間", value: "hour" },
            { name: "日", value: "day" },
            { name: "週", value: "week" },
            { name: "月(30日)", value: "month" },
            { name: "年", value: "year" },
            { name: "無制限", value: "unlimited" },
          ),
      )
      .addUserOption((opt) => opt.setName("user").setDescription("対象ユーザー").setRequired(false))
      .addStringOption((opt) => opt.setName("user_id").setDescription("対象ユーザーID").setRequired(false))
      .addIntegerOption((opt) => opt.setName("duration_value").setDescription("期間の数値（無制限以外で必須）").setRequired(false).setMinValue(1)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("ユーザーをグローバルブラックリストから削除")
      .addUserOption((opt) => opt.setName("user").setDescription("対象ユーザー").setRequired(false))
      .addStringOption((opt) => opt.setName("user_id").setDescription("対象ユーザーID").setRequired(false)),
  )
  .addSubcommand((sub) => sub.setName("list").setDescription("グローバルブラックリストを表示"))
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("特定ユーザーの詳細情報を表示")
      .addUserOption((opt) => opt.setName("user").setDescription("対象ユーザー").setRequired(true)),
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
    const durationType = interaction.options.getString("duration_type", true);
    const durationValue = interaction.options.getInteger("duration_value", false);
    if (durationType !== "unlimited" && !durationValue) {
      return interaction.editReply({ content: "❌ 無制限以外では `duration_value` を指定してください。" });
    }

    const expiresAt = computeExpireAt(durationType, durationValue);
    const added = await GlobalBlacklistDB.add(
      target.userId,
      interaction.user.id,
      reason,
      expiresAt,
      interaction.guildId ?? "DM",
    );
    if (!added) return interaction.editReply({ content: `⚠️ \`${target.userId}\` はすでに登録されています。` });

    return interaction.editReply({
      content: [
        `🚫 \`${target.userId}\` をグローバルブラックリストに追加しました。`,
        `理由: ${reason}`,
        `残り期間: ${formatRemaining(expiresAt)}`,
      ].join("\n"),
    });
  }

  if (sub === "remove") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });
    const removed = await GlobalBlacklistDB.remove(target.userId);
    if (!removed) return interaction.editReply({ content: `⚠️ \`${target.userId}\` は登録されていません。` });
    return interaction.editReply({ content: `✅ \`${target.userId}\` をグローバルブラックリストから削除しました。` });
  }

  if (sub === "list") {
    const entries = GlobalBlacklistDB.findAll();
    if (entries.length === 0) return interaction.editReply({ content: "📋 グローバルブラックリストは空です。" });

    const lines = entries.map((e, i) => `${i + 1}. <@${e.user_id}> / ID: \`${e.user_id}\` / 残り: ${formatRemaining(e.expires_at)} / 理由: ${truncateReason(e.reason)}`);
    const embed = new EmbedBuilder()
      .setTitle("🚫 グローバルブラックリスト")
      .setColor(0xed4245)
      .setDescription(lines.join("\n"))
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  }

  const user = interaction.options.getUser("user", true);
  const entry = GlobalBlacklistDB.find(user.id);
  if (!entry) return interaction.editReply({ content: `ℹ️ <@${user.id}> はグローバルブラックリストに登録されていません。` });

  const guildText = entry.added_in_guild_id === "DM" ? "DM" : `<#${entry.added_in_guild_id}> / \`${entry.added_in_guild_id}\``;
  const embed = new EmbedBuilder()
    .setTitle("🔎 global_blacklist_show")
    .setColor(0xed4245)
    .addFields(
      { name: "ユーザーID", value: entry.user_id, inline: true },
      { name: "名前", value: user.tag, inline: true },
      { name: "施行日時", value: formatDateTime(entry.added_at), inline: true },
      { name: "どこのサーバー", value: guildText, inline: false },
      { name: "理由", value: entry.reason || "(理由なし)", inline: false },
      { name: "残り期限", value: formatRemaining(entry.expires_at), inline: true },
      { name: "設定期限", value: formatDateTime(entry.expires_at), inline: true },
    )
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
