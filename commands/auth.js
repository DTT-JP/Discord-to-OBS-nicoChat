import { randomBytes } from "node:crypto";
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { PendingAuthDB, ActiveSessionDB, AllowedPrincipalDB } from "../database.js";
import { generateAesKey, hashToken } from "../utils/crypto.js";
import { isAdminOrOwner } from "../utils/moderation.js";

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

/** @type {((socketId: string, aesKey: string, maxComments: number, resumeToken: string) => void) | null} */
let distributeKeyFn = null;

/**
 * @param {(socketId: string, aesKey: string, maxComments: number, resumeToken: string) => void} fn
 */
export function setDistributeKeyFn(fn) {
  distributeKeyFn = fn;
}

// ── ブルートフォース保護 ─────────────────────────
/** @type {Map<string, { count: number, lastAttempt: number }>} */
const authAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 5 * 60 * 1000; // 5分
const AUTH_ATTEMPT_SWEEP_MS = 10 * 60 * 1000; // 10分ごと
const AUTH_ATTEMPT_MAX_IDLE_MS = LOCKOUT_MS * 2;

const authAttemptSweeper = setInterval(() => {
  const now = Date.now();
  for (const [uid, rec] of authAttempts) {
    if (!rec || now - rec.lastAttempt > AUTH_ATTEMPT_MAX_IDLE_MS) {
      authAttempts.delete(uid);
    }
  }
}, AUTH_ATTEMPT_SWEEP_MS);
authAttemptSweeper.unref();

export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content:
        "❌ `/auth` は **`/start` を実行したサーバーのテキストチャンネル** で実行してください（DM では認証できません）。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const member = interaction.member;
  if (!member || (!isAdminOrOwner(interaction) && !AllowedPrincipalDB.isAllowed(member))) {
    return interaction.reply({
      content:
        "❌ このコマンドを実行する権限がありません。\n管理者に `/setup allow_start_role` または `/setup allow_start_user` での許可を依頼してください。",
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
  if (!/^\d{6}$/.test(code)) {
    return interaction.editReply({
      content: "❌ 認証コードの形式が不正です（6桁の数字で入力してください）。",
    });
  }

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

  const watchCh = await interaction.client.channels.fetch(pending.channel_id).catch(() => null);
  if (
    !watchCh ||
    !("guildId" in watchCh) ||
    !watchCh.guildId ||
    watchCh.guildId !== interaction.guild.id
  ) {
    return interaction.editReply({
      content:
        "❌ **このサーバーでは認証できません。** `/start` を実行した**同じサーバー**のチャンネルで `/auth` してください。",
    });
  }

  // 認証成功 → 試行カウントをリセット
  authAttempts.delete(userId);

  const aesKey       = generateAesKey();
  const maxComments  = pending.max_comments;
  const resumeToken  = randomBytes(32).toString("hex");
  const secretAllowed = !!pending.secret_allowed;

  await ActiveSessionDB.add({
    token_hash:        pending.token_hash,
    socket_id:         pending.socket_id,
    user_id:           userId,
    channel_id:        pending.channel_id,
    aes_key:           aesKey,
    created_at:        Date.now(),
    max_comments:      maxComments,
    secret_allowed:    secretAllowed,
    resume_token_hash: hashToken(resumeToken),
  });

  await PendingAuthDB.removeByUserId(userId);

  // AES鍵と上限値をクライアントへ配布
  if (distributeKeyFn) {
    distributeKeyFn(pending.socket_id, aesKey, maxComments, resumeToken);
  } else {
    console.error("[auth] distributeKeyFn が未登録です");
  }

  const embed = new EmbedBuilder()
    .setTitle("✅ 認証完了")
    .setColor(0x57f287)
    .setDescription("OBSオーバーレイの接続が確立しました。次回の認証も**サーバー内のチャンネル**で `/auth` を実行してください。")
    .addFields(
      { name: "📡 監視チャンネル",  value: `<#${pending.channel_id}>`, inline: true },
      { name: "💬 同時表示上限",    value: `${maxComments} 件`,        inline: true },
      { name: "🔒 暗号化",          value: "AES-256-GCM",              inline: true },
    )
    .setFooter({ text: "セッションを終了するにはOBSでブラウザソースを閉じてください" })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
