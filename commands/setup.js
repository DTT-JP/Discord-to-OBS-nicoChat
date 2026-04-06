import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
} from "discord.js";
import {
  DenyChannelDB,
  SetupPrincipalDB,
  AllowedPrincipalDB,
} from "../database.js";
import { isAdminOrOwner, parseTargetUser, formatUserTagForReply } from "../utils/moderation.js";
import { ListScope, replyPaginatedList } from "../utils/paginatedList.js";

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

function pageOpt(sub) {
  return sub.addIntegerOption((opt) =>
    opt.setName("page").setDescription("表示するページ（1から）").setMinValue(1).setRequired(false),
  );
}

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("/setup 関連設定")
  .addSubcommand((sub) =>
    sub.setName("overview").setDescription("拒否チャンネル・/start許可・オーバーレイURLの概要を表示"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("add_deny_channel")
      .setDescription("/start で指定禁止のチャンネルを追加")
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("対象チャンネル（テキスト / VC / ステージ）")
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildVoice,
            ChannelType.GuildStageVoice,
          )
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    pageOpt(sub.setName("deny_channel_list").setDescription("拒否チャンネル一覧（10件/ページ）")),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove_deny_channel")
      .setDescription("拒否チャンネルから削除")
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("対象チャンネル（テキスト / VC / ステージ）")
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildVoice,
            ChannelType.GuildStageVoice,
          )
          .setRequired(true),
      ),
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
      .addUserOption((opt) =>
        opt.setName("user").setDescription("許可するユーザー（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("同上・ユーザーID（どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove_start_user")
      .setDescription("/start 許可ユーザーを削除")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("削除するユーザー（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("同上・ユーザーID（どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    pageOpt(sub.setName("allow_start_role_list").setDescription("/start 許可ロール一覧（10件/ページ）")),
  )
  .addSubcommand((sub) =>
    pageOpt(sub.setName("allow_start_user_list").setDescription("/start 許可ユーザー一覧（10件/ページ）")),
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
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });
    await AllowedPrincipalDB.add("user", target.userId, guildId);
    const label = await formatUserTagForReply(interaction.client, target);
    return interaction.editReply({ content: `✅ ユーザー **${label}** を /start 許可に追加しました。` });
  }
  if (sub === "remove_start_user") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });
    await AllowedPrincipalDB.remove("user", target.userId, guildId);
    const label = await formatUserTagForReply(interaction.client, target);
    return interaction.editReply({ content: `🗑️ ユーザー **${label}** を /start 許可から削除しました。` });
  }

  if (sub === "deny_channel_list") return replyPaginatedList(interaction, ListScope.SETUP_DENY);
  if (sub === "allow_start_role_list") return replyPaginatedList(interaction, ListScope.SETUP_START_ROLE);
  if (sub === "allow_start_user_list") return replyPaginatedList(interaction, ListScope.SETUP_START_USER);

  if (sub === "overview") {
    const entries = DenyChannelDB.findByGuild(guildId);
    const denyText =
      entries.length === 0
        ? "なし（詳細は `/setup deny_channel_list`）"
        : `${entries.length} 件登録（/setup deny_channel_list でページ一覧）`;

    const { roles: startRoles, users: startUsers } = formatStartAllows(guildId);
    const baseUrl = buildOverlayBaseUrl();

    const embed = new EmbedBuilder()
      .setTitle("📊 サーバー設定ダッシュボード")
      .setColor(0x5865f2)
      .setDescription("サーバーブラックリスト・`/my-status` 設定は **`/blacklist`** から操作します。")
      .addFields(
        { name: "🚫 拒否チャンネル", value: denyText.slice(0, 1024), inline: false },
        { name: "🎬 /start 許可ロール", value: startRoles.slice(0, 1024), inline: true },
        { name: "🎬 /start 許可ユーザー", value: startUsers.slice(0, 1024), inline: true },
        {
          name: "🌐 オーバーレイ基準URL",
          value: baseUrl.length > 1024 ? `${baseUrl.slice(0, 1000)}…` : baseUrl,
          inline: false,
        },
      )
      .setFooter({ text: "サーバーオーナー・管理者は /start 許可リストなしでも /start 可能です。" })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  if (sub === "add_deny_channel") {
    const channel = interaction.options.getChannel("channel", true);
    const added = await DenyChannelDB.add(guildId, channel.id, interaction.user.id);
    if (!added) return interaction.editReply({ content: `⚠️ <#${channel.id}> はすでに拒否チャンネルです。` });
    return interaction.editReply({ content: `✅ <#${channel.id}> を拒否チャンネルに追加しました。` });
  }

  if (sub === "remove_deny_channel") {
    const channel = interaction.options.getChannel("channel", true);
    const removed = await DenyChannelDB.remove(guildId, channel.id);
    if (!removed) return interaction.editReply({ content: `⚠️ <#${channel.id}> は拒否チャンネルに登録されていません。` });
    return interaction.editReply({ content: `✅ <#${channel.id}> を拒否チャンネルから削除しました。` });
  }

  return interaction.editReply({ content: "❌ 不明なサブコマンドです。" });
}
