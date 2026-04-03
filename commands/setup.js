import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
} from "discord.js";
import {
  DenyChannelDB,
  GuildSettingDB,
  SetupPrincipalDB,
  AllowedPrincipalDB,
  GlobalBlacklistDB,
  LocalBlacklistDB,
} from "../database.js";
import { isAdminOrOwner, formatDateTime, formatRemaining } from "../utils/moderation.js";

function canManageSetup(interaction) {
  if (isAdminOrOwner(interaction)) return true;
  if (!interaction.member) return false;
  return SetupPrincipalDB.isAllowed(interaction.member);
}

function buildOverlayBaseUrl() {
  const pub = (process.env.PUBLIC_URL || "").trim();
  if (pub) return pub.replace(/\/+$/, "");
  const host = (process.env.HOST || "localhost").trim();
  const port = (process.env.PORT || "3000").trim();
  return `http://${host}:${port}`;
}

/**
 * @param {string} guildId
 */
function formatStartAllows(guildId) {
  const principals = AllowedPrincipalDB.findByGuild(guildId);
  const roles = principals.filter((p) => p.type === "role").map((p) => `<@&${p.id}>`);
  const users = principals.filter((p) => p.type === "user").map((p) => `<@${p.id}>`);
  return {
    roles: roles.length ? roles.join("\n") : "なし",
    users: users.length ? users.join("\n") : "なし",
  };
}

/**
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 */
function blacklistInfoLines(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guild?.id;
  const gs = guildId ? GuildSettingDB.find(guildId) : null;

  const globalEntry = GlobalBlacklistDB.find(userId);
  const localEntry = guildId ? LocalBlacklistDB.find(userId, guildId) : null;

  const lines = [
    "**サーバー設定（/my-status 照会）**",
    `・有効: ${gs?.blacklist_status_enabled ? "はい" : "いいえ"}`,
    `・異議申し立てURL: ${gs?.blacklist_appeal_url?.trim() ? gs.blacklist_appeal_url : "未設定"}`,
    "",
    "**あなたの状態**",
    `・グローバルBL: ${globalEntry ? `登録あり（残り: ${formatRemaining(globalEntry.expires_at)}）` : "なし"}`,
    `・グローバル異議URL: ${process.env.GLOBAL_BLACKLIST_APPEAL_URL?.trim() || "未設定"}`,
  ];
  if (guildId) {
    lines.push(`・このサーバーのローカルBL: ${localEntry ? `登録あり（残り: ${formatRemaining(localEntry.expires_at)}）` : "なし"}`);
  }
  return lines.join("\n");
}

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("/setup 関連設定")
  .addSubcommand((sub) => sub.setName("overview").setDescription("拒否チャンネル・/start許可・BL状況・URLをまとめて表示"))
  .addSubcommand((sub) => sub.setName("blacklist_info").setDescription("ブラックリスト状況と異議申し立てURLを表示"))
  .addSubcommand((sub) =>
    sub
      .setName("add_deny_channel")
      .setDescription("/start で指定禁止のチャンネルを追加")
      .addChannelOption((opt) => opt.setName("channel").setDescription("対象チャンネル").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName("deny_channel_list").setDescription("禁止チャンネル一覧を表示"))
  .addSubcommand((sub) =>
    sub
      .setName("del_deny_channel_list")
      .setDescription("禁止チャンネルから削除")
      .addChannelOption((opt) => opt.setName("channel").setDescription("対象チャンネル").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("allow_start_role")
      .setDescription("/start を許可するロールを追加")
      .addRoleOption((opt) => opt.setName("role").setDescription("許可するロール").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove_start_role")
      .setDescription("/start 許可ロールを削除")
      .addRoleOption((opt) => opt.setName("role").setDescription("削除するロール").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("allow_start_user")
      .setDescription("/start を許可するユーザーを追加")
      .addUserOption((opt) => opt.setName("user").setDescription("許可するユーザー").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove_start_user")
      .setDescription("/start 許可ユーザーを削除")
      .addUserOption((opt) => opt.setName("user").setDescription("削除するユーザー").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("set_blacklist_status")
      .setDescription("サーバーブラックリスト照会（/my-status）の可否とURLを設定")
      .addBooleanOption((opt) => opt.setName("enabled").setDescription("有効にするか").setRequired(true))
      .addStringOption((opt) => opt.setName("appeal_url").setDescription("異議申し立て先URL（enabled=true時推奨）").setRequired(false)),
  );

export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ このコマンドはサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const sub = interaction.options.getSubcommand();

  if (!canManageSetup(interaction)) {
    return interaction.reply({
      content:
        "❌ このコマンドはサーバーオーナー・管理者、または `/config` で許可されたユーザーのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild.id;

  if (sub === "allow_start_role") {
    const role = interaction.options.getRole("role", true);
    await AllowedPrincipalDB.add("role", role.id, guildId);
    return interaction.editReply({ content: `✅ ロール **${role.name}** を /start 許可に追加しました。` });
  }
  if (sub === "remove_start_role") {
    const role = interaction.options.getRole("role", true);
    await AllowedPrincipalDB.remove("role", role.id, guildId);
    return interaction.editReply({ content: `🗑️ ロール **${role.name}** を /start 許可から削除しました。` });
  }
  if (sub === "allow_start_user") {
    const user = interaction.options.getUser("user", true);
    await AllowedPrincipalDB.add("user", user.id, guildId);
    return interaction.editReply({ content: `✅ ユーザー **${user.tag}** を /start 許可に追加しました。` });
  }
  if (sub === "remove_start_user") {
    const user = interaction.options.getUser("user", true);
    await AllowedPrincipalDB.remove("user", user.id, guildId);
    return interaction.editReply({ content: `🗑️ ユーザー **${user.tag}** を /start 許可から削除しました。` });
  }

  if (sub === "blacklist_info") {
    const embed = new EmbedBuilder()
      .setTitle("🛡️ ブラックリスト・URL")
      .setColor(0x5865f2)
      .setDescription(blacklistInfoLines(interaction))
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  }

  if (sub === "overview") {
    const entries = DenyChannelDB.findByGuild(guildId);
    const denyText =
      entries.length === 0
        ? "なし"
        : entries
            .slice(0, 15)
            .map((e, i) => `${i + 1}. <#${e.channel_id}>（追加: ${formatDateTime(e.added_at)}）`)
            .join("\n") + (entries.length > 15 ? `\n…他 ${entries.length - 15} 件` : "");

    const { roles: startRoles, users: startUsers } = formatStartAllows(guildId);
    const baseUrl = buildOverlayBaseUrl();

    const embed = new EmbedBuilder()
      .setTitle("📊 サーバー設定ダッシュボード")
      .setColor(0x5865f2)
      .addFields(
        { name: "🚫 拒否チャンネル（/start 禁止）", value: denyText.slice(0, 1024) || "なし", inline: false },
        { name: "🎬 /start 許可ロール", value: startRoles.slice(0, 1024), inline: true },
        { name: "🎬 /start 許可ユーザー", value: startUsers.slice(0, 1024), inline: true },
        {
          name: "🌐 オーバーレイ基準URL",
          value: baseUrl.length > 1024 ? `${baseUrl.slice(0, 1000)}…` : baseUrl,
          inline: false,
        },
      )
      .setTimestamp();

    const blEmbed = new EmbedBuilder()
      .setTitle("🛡️ ブラックリスト・照会URL")
      .setColor(0x57f287)
      .setDescription(blacklistInfoLines(interaction))
      .setFooter({ text: "サーバーオーナー・管理者は /start 許可リストなしでも /start 可能です。" });

    return interaction.editReply({ embeds: [embed, blEmbed] });
  }

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
        `✅ /my-status 照会: ${setting.blacklist_status_enabled ? "有効" : "無効"}`,
        `異議申し立てURL: ${setting.blacklist_appeal_url || "未設定"}`,
      ].join("\n"),
    });
  }

  const entries = DenyChannelDB.findByGuild(guildId);
  if (entries.length === 0) return interaction.editReply({ content: "📋 deny_channel は未登録です。" });

  const lines = entries.map(
    (e, i) =>
      `${i + 1}. <#${e.channel_id}> / 追加者: <@${e.added_by}> / 追加日時: ${formatDateTime(e.added_at)} / 残り: ${formatRemaining(null)}`,
  );
  const embed = new EmbedBuilder()
    .setTitle("🚫 deny_channel 一覧")
    .setColor(0xed4245)
    .setDescription(lines.join("\n").slice(0, 4096))
    .setTimestamp();
  return interaction.editReply({ embeds: [embed] });
}
