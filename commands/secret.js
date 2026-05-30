import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { GlobalBlacklistDB, ActiveSessionDB } from "../database.js";
import { KNOWN_SECRET_EFFECTS, SECRET_EFFECT_CHOICES } from "../utils/secretEffects.js";
import { applySecretToSockets } from "../utils/secretTransport.js";

export const data = new SlashCommandBuilder()
  .setName("secret")
  .setDescription("セッションエフェクトを切り替えます")
  .addStringOption((opt) =>
    opt
      .setName("effect")
      .setDescription("エフェクト名")
      .setRequired(true)
      .addChoices(...SECRET_EFFECT_CHOICES),
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
  if (KNOWN_SECRET_EFFECTS.has(effectRaw)) {
    applySecretToSockets(
      targetSessions.map((s) => s.socket_id).filter(Boolean),
      effectRaw,  // KNOWN_SECRET_EFFECTS で検証済みの名前のみ使用
      value,
    );
  }
  // KNOWN_SECRET_EFFECTS に含まれない名前は applySecretToSockets を呼ばず、
  // 送信なしで成功扱いのままフォールスルーする（意図した動作）

  return interaction.editReply({
    content: value
      ? "✅ エフェクト設定を適用しました。"
      : "✅ エフェクト設定を解除しました。",
  });
}
