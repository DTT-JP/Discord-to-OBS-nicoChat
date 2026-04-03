import { randomUUID } from "node:crypto";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from "discord.js";
import {
  PendingAuthDB,
  DenyChannelDB,
  AllowedPrincipalDB,
  LocalBlacklistDB,
} from "../database.js";
import { isAdminOrOwner } from "../utils/moderation.js";

const MAX_COMMENTS_MIN = 1;
const MAX_COMMENTS_MAX = 99999;
const DEFAULT_MAX_COMMENTS = 30;

function clampMaxComments(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_MAX_COMMENTS;
  const t = Math.trunc(n);
  if (t < MAX_COMMENTS_MIN) return DEFAULT_MAX_COMMENTS;
  return Math.min(MAX_COMMENTS_MAX, t);
}

function buildOverlayBaseUrl() {
  const pub = (process.env.PUBLIC_URL || "").trim();
  if (pub) return pub.replace(/\/+$/, "");
  const host = (process.env.HOST || "localhost").trim();
  const port = (process.env.PORT || "3000").trim();
  return `http://${host}:${port}`;
}

function getCodeExpireMs() {
  const mins = Number.parseInt(process.env.CODE_EXPIRE_MINUTES || "10", 10);
  const safeMins = Number.isFinite(mins) && mins >= 1 && mins <= 24 * 60 ? mins : 10;
  return safeMins * 60 * 1000;
}

function buildOverlayUrl(token) {
  const baseUrl = buildOverlayBaseUrl();
  return `${baseUrl}/?token=${encodeURIComponent(token)}`;
}

/**
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @returns {boolean}
 */
function canStart(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  if (isAdminOrOwner(interaction)) return true;
  return AllowedPrincipalDB.isAllowed(interaction.member);
}

export const data = new SlashCommandBuilder()
  .setName("start")
  .setDescription("OBSオーバーレイのセッションを開始します")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("監視チャンネル")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("limit")
      .setDescription("同時表示上限（1〜99999。未指定ならMAX_COMMENTS）")
      .setMinValue(1)
      .setMaxValue(99999)
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName("secret")
      .setDescription("secretコマンドの許可設定")
      .addChoices(
        { name: "許可", value: "allow" },
        { name: "拒否", value: "deny" },
      )
      .setRequired(false),
  );

export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ `/start` はサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!canStart(interaction)) {
    return interaction.reply({
      content:
        "❌ このコマンドを実行する権限がありません。\n管理者に `/setup allow_start_role` または `/setup allow_start_user` での許可を依頼してください。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  // ローカルブラックリストは /start を明示的に遮断する（OBS表示だけでなく認証フロー自体を止める）
  if (LocalBlacklistDB.has(userId, guildId)) {
    return interaction.reply({
      content: "❌ あなたはこのサーバーのブラックリストに登録されています。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const channel = interaction.options.getChannel("channel", true);
  if (!channel || channel.guildId !== guildId) {
    return interaction.reply({
      content: "❌ 指定されたチャンネルがこのサーバーに属していません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (DenyChannelDB.has(guildId, channel.id)) {
    return interaction.reply({
      content: "❌ このチャンネルでは /start を利用できません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const codeExpireMs = getCodeExpireMs();
  const defaultMaxComments = clampMaxComments(process.env.MAX_COMMENTS || DEFAULT_MAX_COMMENTS);
  const requestedLimit = interaction.options.getInteger("limit", false);
  const maxComments = clampMaxComments(requestedLimit ?? defaultMaxComments);
  const secretMode = interaction.options.getString("secret", false) ?? "allow";
  const secretAllowed = secretMode !== "deny";

  // ユーザー単位で pending を 1 件に寄せて混乱を減らす
  await PendingAuthDB.removeByUserId(userId);

  const token = randomUUID(); // UUID v4（socket/manager.js の形式検証に対応）
  const expiresAt = Date.now() + codeExpireMs;

  await PendingAuthDB.add({
    token,
    socket_id: "",
    user_id: userId,
    channel_id: channel.id,
    expires_at: expiresAt,
    max_comments: maxComments,
    secret_allowed: secretAllowed,
  });

  const overlayUrl = buildOverlayUrl(token);

  const overlayUrlBlock = overlayUrl.length > 900
    ? `\`${overlayUrl}\``
    : `\`\`\`\n${overlayUrl}\n\`\`\``;

  const embed = new EmbedBuilder()
    .setTitle("OBSオーバーレイセッション開始")
    .setColor(0x57f287)
    .setDescription("以下のURLをOBSのブラウザソースに貼り付けてください。")
    .addFields(
      { name: "OBSブラウザソースURL", value: overlayUrlBlock, inline: false },
      { name: "監視チャンネル", value: `<#${channel.id}>`, inline: true },
      { name: "同時表示上限", value: `${maxComments} 件`, inline: true },
      { name: "secretコマンド", value: secretAllowed ? "許可" : "拒否", inline: true },
      { name: "有効期限", value: `${Math.round(codeExpireMs / 60_000)} 分`, inline: true },
      {
        name: "手順",
        value: [
          "1. 上のURLをOBSのブラウザソースで開く",
          "2. 画面に表示された6桁のコードを確認する",
          `3. このサーバーで \`/auth\`（コード入力）を実行して認証する`,
        ].join("\n"),
        inline: false,
      },
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(overlayUrl)
      .setLabel("OBS用URLを開く"),
  );

  try {
    await interaction.user.send({
      embeds: [embed],
      components: [row],
    });
  } catch {
    // DM が閉じられている場合は、URLを表示せず設定見直しを案内する
    return interaction.editReply({
      content: "DM送信できませんでした　設定を見直してください",
    });
  }

  return interaction.editReply({
    content: "✅ OBS オーバーレイのURLをDMで送信しました。",
  });
}

