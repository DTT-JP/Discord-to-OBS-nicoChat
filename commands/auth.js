import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { PendingAuthDB, ActiveSessionDB } from "../database.js";
import { generateAesKey } from "../utils/crypto.js";

export const data = new SlashCommandBuilder()
  .setName("auth")
  .setDescription("OBSオーバーレイの認証コードを入力して接続を完了します")
  .addStringOption((opt) =>
    opt
      .setName("code")
      .setDescription("OBSブラウザに表示された6桁のコード")
      .setRequired(true)
      .setMinLength(6)
      .setMaxLength(6),
  );

/** @type {((socketId: string, aesKey: string, maxComments: number) => void) | null} */
let distributeKeyFn = null;

/**
 * @param {(socketId: string, aesKey: string, maxComments: number) => void} fn
 */
export function setDistributeKeyFn(fn) {
  distributeKeyFn = fn;
}

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  const code   = interaction.options.getString("code", true).trim();

  const pending = PendingAuthDB.findByCodeAndUser(code, userId);

  if (!pending) {
    return interaction.editReply({
      content: "❌ 認証コードが正しくないか、セッションが見つかりません。\n`/start` からやり直してください。",
    });
  }

  if (Date.now() > pending.expires_at) {
    await PendingAuthDB.removeByToken(pending.token);
    return interaction.editReply({
      content: "❌ 認証コードの有効期限が切れています。\n`/start` からやり直してください。",
    });
  }

  if (!pending.socket_id) {
    return interaction.editReply({
      content: "❌ OBSブラウザがまだ接続されていません。\nOBSでURLを開いてからもう一度試してください。",
    });
  }

  const aesKey     = generateAesKey();
  const maxComments = pending.max_comments;   // ← pending から取得

  await ActiveSessionDB.add({
    token:        pending.token,
    socket_id:    pending.socket_id,
    user_id:      userId,
    channel_id:   pending.channel_id,
    aes_key:      aesKey,
    created_at:   Date.now(),
    max_comments: maxComments,                // ← 保存
  });

  await PendingAuthDB.removeByToken(pending.token);

  // AES鍵と上限値をクライアントへ配布
  if (distributeKeyFn) {
    distributeKeyFn(pending.socket_id, aesKey, maxComments);
  } else {
    console.error("[auth] distributeKeyFn が未登録です");
  }

  const embed = new EmbedBuilder()
    .setTitle("✅ 認証完了")
    .setColor(0x57f287)
    .setDescription("OBSオーバーレイの接続が確立されました。")
    .addFields(
      { name: "📡 監視チャンネル",  value: `<#${pending.channel_id}>`, inline: true },
      { name: "💬 同時表示上限",    value: `${maxComments} 件`,        inline: true },
      { name: "🔒 暗号化",          value: "AES-256-GCM",              inline: true },
    )
    .setFooter({ text: "セッションを終了するにはOBSでブラウザソースを閉じてください" })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}