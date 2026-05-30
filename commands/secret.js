import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { GlobalBlacklistDB, ActiveSessionDB } from "../database.js";
import { SECRET_EFFECT_CHOICES, validateSecretEffect } from "../utils/secretEffects.js";
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

  const effectRaw = interaction.options.getString("effect", true);
  const value     = interaction.options.getBoolean("value", true);
  const channel   = interaction.channelId;

  const sessions = ActiveSessionDB.findByChannelId(channel);

  if (sessions.length === 0) {
    return interaction.editReply({
      content: "❌ このチャンネルにはアクティブなセッションがありません。",
    });
  }

  const targetSessions = sessions.filter((s) => s.user_id === interaction.user.id || !!s.secret_allowed);
  if (targetSessions.length === 0) {
    return interaction.editReply({
      content: "❌ このチャンネルではこのコマンドを使用できません。",
    });
  }

  const effectValidation = validateSecretEffect(effectRaw);
  if (!effectValidation.ok) {
    return interaction.editReply({
      content: effectValidation.message,
    });
  }

  applySecretToSockets(
    targetSessions.map((s) => s.socket_id).filter(Boolean),
    effectValidation.effect,
    value,
  );

  return interaction.editReply({
    content: value
      ? "✅ エフェクト設定を適用しました。"
      : "✅ エフェクト設定を解除しました。",
  });
}
