import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { PendingAuthDB, ActiveSessionDB, AllowedPrincipalDB } from "../database.js";
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

// ── ブルートフォース保護 ─────────────────────────
/** @type {Map<string, { count: number, lastAttempt: number }>} */
const authAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 5 * 60 * 1000; // 5分

export async function execute(interaction) {
  // ── setup で許可されたロール/ユーザーのみ実行可能 ──
  const member = interaction.member;
  if (!AllowedPrincipalDB.isAllowed(member)) {
    return interaction.reply({
      content: "❌ このコマンドを実行する権限がありません。\nサーバーオーナーに `/setup allow_role` または `/setup allow_user` での許可を依頼してください。",
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── ブルートフォース保護 ──────────────────────
  const userId = interaction.user.id;
  const now    = Date.now();
  const record = authAttempts.get(userId) ?? { count: 0, lastAttempt: 0 };

  // ロックアウト期間が過ぎていたらリセット
  if (now - record.lastAttempt >= LOCKOUT_MS) {
    record.count = 0;
  }

  // ロックアウト中なら拒否
  if (record.count >= MAX_ATTEMPTS && now - record.lastAttempt < LOCKOUT_MS) {
    const remainMs  = LOCKOUT_MS - (now - record.lastAttempt);
    const remainMin = Math.ceil(remainMs / 60_000);
    return interaction.reply({
      content: `❌ 試行回数の上限（${MAX_ATTEMPTS}回）に達しました。約 ${remainMin} 分後に再試行してください。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const code = interaction.options.getString("code", true).trim();

  // 試行回数をカウント（検証前にインクリメント）
  record.count++;
  record.lastAttempt = now;
  authAttempts.set(userId, record);

  const pending = PendingAuthDB.findByCodeAndUser(code, userId);

  if (!pending) {
    const remains = Math.max(0, MAX_ATTEMPTS - record.count);
    return interaction.editReply({
      content: `❌ 認証コードが正しくないか、セッションが見つかりません。\n\`/start\` からやり直してください。（残り試行回数: ${remains}）`,
    });
  }

  if (Date.now() > pending.expires_at) {
    await PendingAuthDB.removeByUserId(userId);
    return interaction.editReply({
      content: "❌ 認証コードの有効期限が切れています。\n`/start` からやり直してください。",
    });
  }

  if (!pending.socket_id) {
    return interaction.editReply({
      content: "❌ OBSブラウザがまだ接続されていません。\nOBSでURLを開いてからもう一度試してください。",
    });
  }

  // 認証成功 → 試行カウントをリセット
  authAttempts.delete(userId);

  const aesKey      = generateAesKey();
  const maxComments = pending.max_comments;

  await ActiveSessionDB.add({
    token:        pending.token,
    socket_id:    pending.socket_id,
    user_id:      userId,
    channel_id:   pending.channel_id,
    aes_key:      aesKey,
    created_at:   Date.now(),
    max_comments: maxComments,
  });

  await PendingAuthDB.removeByUserId(userId);

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
