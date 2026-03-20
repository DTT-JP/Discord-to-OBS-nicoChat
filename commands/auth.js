import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
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

// socket/manager.js から注入されるコールバック
// AES鍵をクライアントに送信するための関数
/** @type {((socketId: string, aesKey: string) => void) | null} */
let distributeKeyFn = null;

/**
 * Socket Manager から呼び出し、鍵配布関数を登録する
 * @param {(socketId: string, aesKey: string) => void} fn
 */
export function setDistributeKeyFn(fn) {
  distributeKeyFn = fn;
}

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });


  const userId = interaction.user.id;
  const code   = interaction.options.getString("code", true).trim();

  // ── pending_auth を code + user_id で検索 ────
  const pending = PendingAuthDB.findByCodeAndUser(code, userId);

  if (!pending) {
    return interaction.editReply({
      content: "❌ 認証コードが正しくないか、該当するセッションが見つかりません。\n`/start` からやり直してください。",
    });
  }

  // ── 有効期限チェック ──────────────────────────
  if (Date.now() > pending.expires_at) {
    await PendingAuthDB.removeByToken(pending.token);
    return interaction.editReply({
      content: "❌ 認証コードの有効期限が切れています。\n`/start` からやり直してください。",
    });
  }

  // ── Socket接続確認 ────────────────────────────
  if (!pending.socket_id) {
    return interaction.editReply({
      content: "❌ OBSブラウザがまだ接続されていません。\nOBSでURLを開いてからもう一度試してください。",
    });
  }

  // ── AES鍵生成・セッション昇格 ────────────────
  const aesKey = generateAesKey();

  await ActiveSessionDB.add({
    token:      pending.token,
    socket_id:  pending.socket_id,
    user_id:    userId,
    channel_id: pending.channel_id,
    aes_key:    aesKey,
    created_at: Date.now(),
  });

  await PendingAuthDB.removeByToken(pending.token);

  // ── AES鍵をクライアントへ配布 ────────────────
  if (distributeKeyFn) {
    distributeKeyFn(pending.socket_id, aesKey);
  } else {
    console.error("[auth] distributeKeyFn が未登録です");
  }

  // ── 完了通知 ──────────────────────────────────
  const embed = new EmbedBuilder()
    .setTitle("✅ 認証完了")
    .setColor(0x57f287)
    .setDescription("OBSオーバーレイの接続が確立されました。")
    .addFields(
      {
        name:   "📡 監視チャンネル",
        value:  `<#${pending.channel_id}>`,
        inline: true,
      },
      {
        name:   "🔒 暗号化",
        value:  "AES-256-GCM",
        inline: true,
      },
    )
    .setFooter({ text: "セッションを終了するには OBS でブラウザソースを閉じてください" })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}