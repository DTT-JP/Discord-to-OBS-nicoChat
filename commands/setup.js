import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
} from "discord.js";
import { DenyChannelDB, GuildSettingDB, SetupPrincipalDB } from "../database.js";
import { isAdminOrOwner, formatDateTime, formatRemaining } from "../utils/moderation.js";

function canManageSetup(interaction) {
  if (isAdminOrOwner(interaction)) return true;
  return SetupPrincipalDB.isAllowed(interaction.member);
}

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("/setup 関連設定")
  .addSubcommand((sub) =>
    sub
      .setName("add_deny_channel")
      .setDescription("/start で指定禁止のチャンネルを追加")
      .addChannelOption((opt) => opt.setName("channel").setDescription("対象チャンネル").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName("deny_channel_list").setDescription("禁止チャンネル一覧を表示"))
  .addSubcommand((sub) =>
    sub
      .setName("del_deny_channel_list")
      .setDescription("禁止チャンネルから削除")
      .addChannelOption((opt) => opt.setName("channel").setDescription("対象チャンネル").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("set_blacklist_status")
      .setDescription("サーバーブラックリスト照会コマンドの可否/URLを設定")
      .addBooleanOption((opt) => opt.setName("enabled").setDescription("有効にするか").setRequired(true))
      .addStringOption((opt) => opt.setName("appeal_url").setDescription("異議申し立て先URL（enabled=true時推奨）").setRequired(false)),
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (!canManageSetup(interaction)) {
    return interaction.reply({
      content: "❌ このコマンドはサーバーオーナー/管理者、または /config で許可されたユーザーのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild.id;

  if (sub === "add_deny_channel") {
    const channel = interaction.options.getChannel("channel", true);
    const added = await DenyChannelDB.add(guildId, channel.id, interaction.user.id);
    if (!added) return interaction.editReply({ content: `⚠️ <#${channel.id}> はすでに拒否チャンネルです。` });
    return interaction.editReply({ content: `✅ <#${channel.id}> を拒否チャンネルに追加しました。` });
  }

  if (sub === "del_deny_channel_list") {
    const channel = interaction.options.getChannel("channel", true);
    const removed = await DenyChannelDB.remove(guildId, channel.id);
    if (!removed) return interaction.editReply({ content: `⚠️ <#${channel.id}> は拒否チャンネルに登録されていません。` });
    return interaction.editReply({ content: `✅ <#${channel.id}> を拒否チャンネルから削除しました。` });
  }

  if (sub === "set_blacklist_status") {
    const enabled = interaction.options.getBoolean("enabled", true);
    const appealUrl = interaction.options.getString("appeal_url", false)?.trim() ?? "";
    const setting = await GuildSettingDB.upsert(guildId, {
      blacklist_status_enabled: enabled,
      blacklist_appeal_url: appealUrl,
    });
    return interaction.editReply({
      content: [
        `✅ blacklist_status: ${setting.blacklist_status_enabled ? "有効" : "無効"}`,
        `異議申し立てURL: ${setting.blacklist_appeal_url || "未設定"}`,
      ].join("\n"),
    });
  }

  const entries = DenyChannelDB.findByGuild(guildId);
  if (entries.length === 0) return interaction.editReply({ content: "📋 deny_channel は未登録です。" });

  const lines = entries.map((e, i) => `${i + 1}. <#${e.channel_id}> / 追加者: <@${e.added_by}> / 追加日時: ${formatDateTime(e.added_at)} / 残り: ${formatRemaining(null)}`);
  const embed = new EmbedBuilder()
    .setTitle("🚫 deny_channel 一覧")
    .setColor(0xed4245)
    .setDescription(lines.join("\n"))
    .setTimestamp();
  return interaction.editReply({ embeds: [embed] });
}
