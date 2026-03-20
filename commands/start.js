import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { v4 as uuidv4 } from "uuid";
import { AllowedPrincipalDB, PendingAuthDB, ActiveSessionDB } from "../database.js";

const {
  HOST,
  PORT,
  PUBLIC_URL,
  CODE_EXPIRE_MINUTES = "10",
  MAX_COMMENTS        = "30",
} = process.env;

/**
 * ベースURLを構築する
 * PUBLIC_URL が設定されていればそちらを優先、
 * 未設定の場合は http://HOST:PORT にフォールバック
 */
const BASE_URL = PUBLIC_URL?.trim()
  ? PUBLIC_URL.trim().replace(/\/$/, "")  // 末尾スラッシュを除去
  : `http://${HOST}:${PORT}`;

export const data = new SlashCommandBuilder()
  .setName("start")
  .setDescription("OBS用オーバーレイのセッションを開始します")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("配信するチャンネルを指定してください")
      .setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("limit")
      .setDescription(`同時表示コメント上限数（未指定時: ${MAX_COMMENTS}）`)
      .setMinValue(1)
      .setMaxValue(99999)
      .setRequired(false),
  );

export async function execute(interaction) {
  // ── 権限チェック ──────────────────────────────
  const member = interaction.member;
  if (!AllowedPrincipalDB.isAllowed(member)) {
    return interaction.reply({
      content: "❌ このコマンドを実行する権限がありません。\nサーバーオーナーに `/setup allow_role` または `/setup allow_user` での許可を依頼してください。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId      = interaction.user.id;
  const channel     = interaction.options.getChannel("channel", true);
  const maxComments = interaction.options.getInteger("limit") ?? Number(MAX_COMMENTS);

  // ── Botのチャンネルアクセス権限チェック ──────────
  const botMember  = interaction.guild.members.me;
  const perms      = channel.permissionsFor(botMember);
  const hasView    = perms?.has(PermissionFlagsBits.ViewChannel)        ?? false;
  const hasRead    = perms?.has(PermissionFlagsBits.ReadMessageHistory) ?? false;

  if (!hasView || !hasRead) {
    const missing = [
      !hasView ? "チャンネルを見る"         : null,
      !hasRead ? "メッセージ履歴を読む" : null,
    ]
      .filter(Boolean)
      .join("、");

    return interaction.editReply({
      content: [
        `❌ Botが <#${channel.id}> にアクセスできません。`,
        `不足している権限: **${missing}**`,
        "",
        "チャンネルの権限設定を確認してください。",
      ].join("\n"),
    });
  }

  // ── 既存セッションの破棄（1ユーザー1セッション） ──
  await Promise.all([
    ActiveSessionDB.removeByUserId(userId),
    PendingAuthDB.removeByUserId(userId),
  ]);

  // ── トークン生成・DB登録 ──────────────────────
  const token     = uuidv4();
  const expiresAt = Date.now() + Number(CODE_EXPIRE_MINUTES) * 60 * 1000;

  await PendingAuthDB.add({
    token,
    socket_id:    "",
    user_id:      userId,
    channel_id:   channel.id,
    code:         "",
    expires_at:   expiresAt,
    max_comments: maxComments,
  });

  // ── OBSブラウザソース用URL生成 ────────────────
  const url = `${BASE_URL}/?token=${token}`;

  // ── DM送信 ───────────────────────────────────
  const embed = new EmbedBuilder()
    .setTitle("🎬 OBSオーバーレイ セッション開始")
    .setColor(0x57f287)
    .setDescription("以下のURLをOBSのブラウザソースに貼り付けてください。")
    .addFields(
      {
        name:   "📺 OBSブラウザソースURL",
        value:  `\`\`\`${url}\`\`\``,
        inline: false,
      },
      {
        name:   "📡 監視チャンネル",
        value:  `<#${channel.id}>`,
        inline: true,
      },
      {
        name:   "💬 同時表示上限",
        value:  `${maxComments} 件`,
        inline: true,
      },
      {
        name:   "⏰ 有効期限",
        value:  `${CODE_EXPIRE_MINUTES}分以内に認証を完了してください`,
        inline: true,
      },
    )
    .addFields({
      name:  "🔐 認証手順",
      value: [
        "1. 上記URLをOBSのブラウザソースで開く",
        "2. 画面に表示された6桁のコードを確認する",
        "3. このサーバーで `/auth [コード]` を実行する",
      ].join("\n"),
    })
    .setFooter({ text: "このメッセージは本人のみに表示されています" })
    .setTimestamp();

  try {
    await interaction.user.send({ embeds: [embed] });
    await interaction.editReply({
      content: [
        "✅ DMにURLを送信しました。",
        `同時表示上限: **${maxComments}件**`,
        "OBSでURLを開いた後、表示されたコードで `/auth` を実行してください。",
      ].join("\n"),
    });
  } catch {
    // DMが拒否されている場合はチャンネルにephemeralで返す
    await interaction.editReply({ embeds: [embed] });
  }
}