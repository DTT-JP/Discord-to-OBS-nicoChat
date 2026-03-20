import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { v4 as uuidv4 } from "uuid";
import { AllowedPrincipalDB, PendingAuthDB, ActiveSessionDB } from "../database.js";

const { HOST, PORT, CODE_EXPIRE_MINUTES = "10" } = process.env;

export const data = new SlashCommandBuilder()
  .setName("start")
  .setDescription("OBS用オーバーレイのセッションを開始します")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("配信するチャンネルを指定してください")
      .setRequired(true),
  );

export async function execute(interaction) {
  // ── 権限チェック ──────────────────────────────
  const member = interaction.member;
  if (!AllowedPrincipalDB.isAllowed(member)) {
    return interaction.reply({
      content: "❌ このコマンドを実行する権限がありません。サーバーオーナーに `/setup allow_role` または `/setup allow_user` での許可を依頼してください。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId  = interaction.user.id;
  const channel = interaction.options.getChannel("channel", true);

  // ── Botのチャンネルアクセス権限チェック ─────────
  const botMember = interaction.guild.members.me;
  const perms     = channel.permissionsFor(botMember);

  const hasViewChannel  = perms?.has(PermissionFlagsBits.ViewChannel)      ?? false;
  const hasReadHistory  = perms?.has(PermissionFlagsBits.ReadMessageHistory) ?? false;

  if (!hasViewChannel || !hasReadHistory) {
    const missing = [
      !hasViewChannel ? "チャンネルを見る" : null,
      !hasReadHistory ? "メッセージ履歴を読む" : null,
    ]
      .filter(Boolean)
      .join("、");

    return interaction.editReply({
      content: `❌ Botが <#${channel.id}> にアクセスできません。\n不足している権限: **${missing}**\n\nチャンネルの権限設定を確認してください。`,
    });
  }

  // ── 既存セッションの破棄（1ユーザー1セッション） ──
  const existingActive  = ActiveSessionDB.findByUserId(userId);
  const existingPending = PendingAuthDB.findByUserId(userId);

  if (existingActive)  await ActiveSessionDB.removeByUserId(userId);
  if (existingPending) await PendingAuthDB.removeByUserId(userId);

  // ── トークン生成・DB登録 ──────────────────────
  const token     = uuidv4();
  const expiresAt = Date.now() + Number(CODE_EXPIRE_MINUTES) * 60 * 1000;

  await PendingAuthDB.add({
    token,
    socket_id:  "",
    user_id:    userId,
    channel_id: channel.id,
    code:       "",
    expires_at: expiresAt,
  });

  // ── URL 生成 ──────────────────────────────────
  const url = `http://${HOST}:${PORT}/?token=${token}`;

  // ── DM 送信 ───────────────────────────────────
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
        name:   "⏰ 有効期限",
        value:  `${CODE_EXPIRE_MINUTES}分以内に認証を完了してください`,
        inline: true,
      },
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
      content: "✅ DMにURLを送信しました。OBSでURLを開いた後、表示されたコードで `/auth` を実行してください。",
    });
  } catch {
    await interaction.editReply({ embeds: [embed] });
  }
}