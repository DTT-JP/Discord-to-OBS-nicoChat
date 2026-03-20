import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { v4 as uuidv4 } from "uuid";
import { AllowedPrincipalDB, PendingAuthDB, ActiveSessionDB } from "../database.js";

const {
  HOST,
  PORT,
  CODE_EXPIRE_MINUTES = "10",
  MAX_COMMENTS        = "30",
} = process.env;

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
      .setDescription(`同時表示コメント上限（未指定時: ${MAX_COMMENTS}）最大10000`)
      .setMinValue(1)
      .setMaxValue(10000)
      .setRequired(false),
  );

export async function execute(interaction) {
  // ── 権限チェック ──────────────────────────────
  const member = interaction.member;
  if (!AllowedPrincipalDB.isAllowed(member)) {
    return interaction.reply({
      content: "❌ このコマンドを実行する権限がありません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId     = interaction.user.id;
  const channel    = interaction.options.getChannel("channel", true);
  const maxComments = interaction.options.getInteger("limit") ?? Number(MAX_COMMENTS);

  // ── Botのチャンネルアクセス権限チェック ─────────
  const botMember = interaction.guild.members.me;
  const perms     = channel.permissionsFor(botMember);
  const hasView   = perms?.has(PermissionFlagsBits.ViewChannel)       ?? false;
  const hasRead   = perms?.has(PermissionFlagsBits.ReadMessageHistory) ?? false;

  if (!hasView || !hasRead) {
    const missing = [
      !hasView ? "チャンネルを見る" : null,
      !hasRead ? "メッセージ履歴を読む" : null,
    ].filter(Boolean).join("、");

    return interaction.editReply({
      content: `❌ Botが <#${channel.id}> にアクセスできません。\n不足権限: **${missing}**`,
    });
  }

  // ── 既存セッション破棄 ────────────────────────
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
    max_comments: maxComments,    // ← 追加
  });

  // ── URL 生成・DM 送信 ─────────────────────────
  const url = `http://${HOST}:${PORT}/?token=${token}`;

  const embed = new EmbedBuilder()
    .setTitle("🎬 OBSオーバーレイ セッション開始")
    .setColor(0x57f287)
    .setDescription("以下のURLをOBSのブラウザソースに貼り付けてください。")
    .addFields(
      { name: "📺 OBSブラウザソースURL", value: `\`\`\`${url}\`\`\``, inline: false },
      { name: "📡 監視チャンネル",       value: `<#${channel.id}>`,   inline: true  },
      { name: "💬 同時表示上限",         value: `${maxComments} 件`,  inline: true  },
      { name: "⏰ 有効期限",             value: `${CODE_EXPIRE_MINUTES}分以内に認証を完了してください`, inline: true },
    )
    .addFields({
      name:  "🔐 認証手順",
      value: "1. 上記URLをOBSブラウザソースで開く\n2. 画面に表示された6桁のコードを確認\n3. このサーバーで `/auth [コード]` を実行",
    })
    .setFooter({ text: "このメッセージは本人のみに表示されています" })
    .setTimestamp();

  try {
    await interaction.user.send({ embeds: [embed] });
    await interaction.editReply({
      content: `✅ DMにURLを送信しました。同時表示上限: **${maxComments}件**`,
    });
  } catch {
    await interaction.editReply({ embeds: [embed] });
  }
}