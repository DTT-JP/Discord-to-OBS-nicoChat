import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { LocalBlacklistDB } from "../database.js";
import {
  isAdminOrOwner,
  parseTargetUser,
  computeExpireAt,
  formatRemaining,
  truncateReason,
  formatDateTime,
} from "../utils/moderation.js";

export const data = new SlashCommandBuilder()
  .setName("blacklist")
  .setDescription("このサーバーのブラックリストを管理します（サーバーオーナー・管理者専用）")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("ユーザーをこのサーバーのブラックリストに追加します")
      .addUserOption((opt) => opt.setName("user").setDescription("対象ユーザー（@メンション）").setRequired(false))
      .addStringOption((opt) => opt.setName("user_id").setDescription("対象ユーザーID").setRequired(false))
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
      .addIntegerOption((opt) => opt.setName("duration_value").setDescription("期間の数値（無制限以外で必須）").setRequired(false).setMinValue(1)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("ユーザーをこのサーバーのブラックリストから削除します")
      .addUserOption((opt) => opt.setName("user").setDescription("対象ユーザー").setRequired(false))
      .addStringOption((opt) => opt.setName("user_id").setDescription("対象ユーザーID").setRequired(false)),
  )
  .addSubcommand((sub) => sub.setName("list").setDescription("このサーバーのブラックリストを表示します"))
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("特定ユーザーの詳細情報を表示")
      .addUserOption((opt) => opt.setName("user").setDescription("対象ユーザー").setRequired(true)),
  );

export async function execute(interaction) {
  if (!isAdminOrOwner(interaction)) {
    return interaction.reply({ content: "❌ このコマンドはサーバーオーナーまたは管理者権限を持つユーザーのみ実行できます。", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.guild) {
    return interaction.reply({ content: "❌ このコマンドはサーバー内でのみ実行できます。", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

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
    const added = await LocalBlacklistDB.add(target.userId, guildId, interaction.user.id, reason, expiresAt);
    if (!added) return interaction.editReply({ content: `⚠️ <@${target.userId}> はすでに登録されています。` });

    return interaction.editReply({
      content: [
        `🚫 <@${target.userId}> をサーバーブラックリストに追加しました。`,
        `理由: ${reason}`,
        `残り期間: ${formatRemaining(expiresAt)}`,
      ].join("\n"),
    });
  }

  if (sub === "remove") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });
    const removed = await LocalBlacklistDB.remove(target.userId, guildId);
    if (!removed) return interaction.editReply({ content: `⚠️ <@${target.userId}> は登録されていません。` });
    return interaction.editReply({ content: `✅ <@${target.userId}> をサーバーブラックリストから削除しました。` });
  }

  if (sub === "list") {
    const entries = LocalBlacklistDB.findByGuild(guildId);
    if (entries.length === 0) return interaction.editReply({ content: "📋 このサーバーのブラックリストは空です。" });

    const lines = entries.map((e, i) => `${i + 1}. <@${e.user_id}> / ID: \`${e.user_id}\` / 残り: ${formatRemaining(e.expires_at)} / 理由: ${truncateReason(e.reason)}`);
    const embed = new EmbedBuilder()
      .setTitle("🚫 サーバーブラックリスト")
      .setColor(0xed4245)
      .setDescription(lines.join("\n"))
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  }

  const user = interaction.options.getUser("user", true);
  const entry = LocalBlacklistDB.find(user.id, guildId);
  if (!entry) return interaction.editReply({ content: `ℹ️ <@${user.id}> はこのサーバーのブラックリストに登録されていません。` });

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const embed = new EmbedBuilder()
    .setTitle("🔎 blacklist_show")
    .setColor(0xed4245)
    .addFields(
      { name: "ユーザーID", value: entry.user_id, inline: true },
      { name: "名前", value: user.tag, inline: true },
      { name: "サーバー内表示名", value: member?.displayName ?? "取得不可", inline: true },
      { name: "施行日時", value: formatDateTime(entry.added_at), inline: true },
      { name: "どこのサーバー", value: interaction.guild.name, inline: true },
      { name: "理由", value: entry.reason || "(理由なし)", inline: false },
      { name: "残り期限", value: formatRemaining(entry.expires_at), inline: true },
      { name: "設定期限", value: formatDateTime(entry.expires_at), inline: true },
    )
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
