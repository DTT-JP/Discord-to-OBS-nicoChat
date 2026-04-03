import { randomUUID } from "node:crypto";
import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import {
  PendingAuthDB,
  AllowedPrincipalDB,
  DenyChannelDB,
  LocalBlacklistDB,
} from "../database.js";
import { isAdminOrOwner } from "../utils/moderation.js";

const MAX_LIMIT = 99999;
const MIN_LIMIT = 1;

function getMaxCommentsDefault() {
  const n = Number(process.env.MAX_COMMENTS);
  return Number.isFinite(n) && n >= MIN_LIMIT && n <= MAX_LIMIT ? Math.floor(n) : 30;
}

function buildOverlayBaseUrl() {
  const pub = (process.env.PUBLIC_URL || "").trim();
  if (pub) return pub.replace(/\/+$/, "");
  const host = (process.env.HOST || "localhost").trim();
  const port = (process.env.PORT || "3000").trim();
  return `http://${host}:${port}`;
}

/**
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 */
function canUseStart(interaction) {
  if (!interaction.member) return false;
  return isAdminOrOwner(interaction) || AllowedPrincipalDB.isAllowed(interaction.member);
}

export const data = new SlashCommandBuilder()
  .setName("start")
  .setDescription("OBSオーバーレイのセッションを開始します（DMにURLを送ります）")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("コメントを拾うテキストチャンネル")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("limit")
      .setDescription("同時表示上限（省略時は環境変数 MAX_COMMENTS）")
      .setMinValue(MIN_LIMIT)
      .setMaxValue(MAX_LIMIT)
      .setRequired(false),
  );

export async function execute(interaction) {
  if (!interaction.guild || !interaction.member) {
    return interaction.reply({
      content: "❌ このコマンドはサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!canUseStart(interaction)) {
    return interaction.reply({
      content:
        "❌ このコマンドを実行する権限がありません。\n管理者に `/setup allow_start_role` または `/setup allow_start_user` での許可を依頼してください。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const channel = interaction.options.getChannel("channel", true);
  const guildId = interaction.guild.id;

  if (DenyChannelDB.has(guildId, channel.id)) {
    return interaction.reply({
      content: `❌ このチャンネル（<#${channel.id}>）は /start での指定が禁止されています。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (LocalBlacklistDB.has(interaction.user.id, guildId)) {
    return interaction.reply({
      content: "❌ このサーバーではOBS連携を利用できません（サーバーブラックリスト）。",
      flags: MessageFlags.Ephemeral,
    });
  }

  let limit = interaction.options.getInteger("limit");
  if (limit == null) limit = getMaxCommentsDefault();
  limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limit));

  const token = randomUUID();
  const expireMin = Math.max(1, Math.min(240, Number(process.env.CODE_EXPIRE_MINUTES) || 10));
  const expires_at = Date.now() + expireMin * 60 * 1000;

  await PendingAuthDB.removeByUserId(interaction.user.id);
  await PendingAuthDB.add({
    token,
    socket_id: "",
    user_id: interaction.user.id,
    channel_id: channel.id,
    expires_at,
    max_comments: limit,
  });

  const base = buildOverlayBaseUrl();
  const url = `${base}/?token=${encodeURIComponent(token)}`;

  const embed = new EmbedBuilder()
    .setTitle("🎬 OBS オーバーレイ")
    .setColor(0x5865f2)
    .setDescription(
      "次の URL を OBS のブラウザソースに貼り付けてください。表示されたコードを `/auth` で入力してください。",
    )
    .addFields(
      { name: "監視チャンネル", value: `<#${channel.id}>`, inline: true },
      { name: "同時表示上限", value: String(limit), inline: true },
      { name: "トークン有効期限", value: `約 ${expireMin} 分`, inline: true },
    );

  try {
    await interaction.user.send({ content: url, embeds: [embed] });
  } catch {
    return interaction.reply({
      content:
        "❌ DM に URL を送れませんでした。Discord のプライバシー設定で「サーバーにいるメンバーからのダイレクトメッセージ」を許可してください。",
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    content: "✅ DM にオーバーレイ URL を送信しました。受信トレイを確認してください。",
    flags: MessageFlags.Ephemeral,
  });
}
