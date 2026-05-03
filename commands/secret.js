import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { GlobalBlacklistDB, ActiveSessionDB } from "../database.js";

let applySecretFn = null;

// OBS クライアント側で実装されているエフェクト名の正規セット。
// このセットに含まれる名前のみ apply_secret イベントとして送信する。
// ユーザー入力をそのまま送信しないことで意図しないエフェクト名の流入を防ぐ。
const KNOWN_EFFECTS = new Set(["gaming", "reverse"]);

export function setApplySecretFn(fn) {
  applySecretFn = fn;
}

export const data = new SlashCommandBuilder()
  .setName("secret")
  .setDescription("セッションエフェクトを切り替えます")
  .addStringOption((opt) =>
    opt
      .setName("effect")
      .setDescription("エフェクト名")
      .setRequired(true)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("value")
      .setDescription("true = 有効化 / false = 無効化")
      .setRequired(true),
  );

export async function execute(interaction) {
  if (GlobalBlacklistDB.has(interaction.user.id)) {
    return interaction.reply({
      content: "このBotを利用する権限がありません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const effectRaw = interaction.options.getString("effect", true).trim().toLowerCase();
  const value     = interaction.options.getBoolean("value", true);
  const channel   = interaction.channelId;

  const sessions = ActiveSessionDB.findByChannelId(channel);

  if (sessions.length === 0) {
    return interaction.editReply({
      content: "❌ このチャンネルにはアクティブなセッションがありません。",
    });
  }

  const isOwner = !!process.env.BOT_OWNER_ID?.trim() && process.env.BOT_OWNER_ID.trim() === interaction.user.id;
  const targetSessions = isOwner ? sessions : sessions.filter((s) => s.user_id === interaction.user.id || !!s.secret_allowed);
  if (targetSessions.length === 0) {
    return interaction.editReply({
      content: "❌ このチャンネルではこのコマンドを使用できません。",
    });
  }

  // 既知エフェクト名のみOBSへ送信する。
  // 未知の名前の場合でも成功扱いのまま（意図した動作）とするが、
  // クライアントへの送信は行わない。
  if (KNOWN_EFFECTS.has(effectRaw) && applySecretFn) {
    applySecretFn(
      targetSessions.map((s) => s.socket_id).filter(Boolean),
      effectRaw,  // KNOWN_EFFECTS で検証済みの名前のみ使用
      value,
    );
  } else if (KNOWN_EFFECTS.has(effectRaw) && !applySecretFn) {
    console.error("[secret] applySecretFn が未登録です");
  }
  // KNOWN_EFFECTS に含まれない名前は applySecretFn を呼ばず、
  // 送信なしで成功扱いのままフォールスルーする（意図した動作）

  return interaction.editReply({
    content: value
      ? "✅ エフェクト設定を適用しました。"
      : "✅ エフェクト設定を解除しました。",
  });
}
