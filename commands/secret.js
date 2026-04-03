import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { GlobalBlacklistDB, ActiveSessionDB } from "../database.js";

let applySecretFn = null;
const EFFECTS = new Set(["gaming", "reverse"]);

export function setApplySecretFn(fn) {
  applySecretFn = fn;
}

export const data = new SlashCommandBuilder()
  .setName("secret")
  .setDescription(".")
  .addStringOption((opt) =>
    opt
      .setName("effect")
      .setDescription(".")
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

  const effect  = interaction.options.getString("effect", true).trim().toLowerCase();
  const value   = interaction.options.getBoolean("value", true);
  const channel = interaction.channelId;

  const sessions = ActiveSessionDB.findByChannelId(channel);

  if (sessions.length === 0) {
    return interaction.editReply({
      content: "セッションがありません",
    });
  }

  const shouldApply = EFFECTS.has(effect);
  const targetSessions = sessions.filter((s) => s.user_id === interaction.user.id || !!s.secret_allowed);
  if (targetSessions.length === 0) {
    return interaction.editReply({
      content: "このコマンドは使用できません",
    });
  }
  if (shouldApply && targetSessions.length > 0 && applySecretFn) {
    applySecretFn(targetSessions.map((s) => s.socket_id).filter(Boolean), effect, value);
  } else if (shouldApply && targetSessions.length > 0 && !applySecretFn) {
    console.error("[secret] applySecretFn が未登録です");
  }

  return interaction.editReply({
    content: value
      ? "そのエフェクトを適応しました"
      : "そのエフェクトを削除しました",
  });
}
