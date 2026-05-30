import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { ActiveSessionDB } from "../database.js";
import { isKnownSecretEffect, normalizeSecretEffect } from "../utils/secretEffects.js";
import { applySecretToSockets } from "../utils/secretTransport.js";

const MODE_ENABLE = "enable";
const MODE_DISABLE = "disable";

export const data = new SlashCommandBuilder()
  .setName("secret-admin")
  .setDescription("Bot管理者向け: 指定セッションのエフェクトを切り替えます")
  .addStringOption((opt) =>
    opt
      .setName("session_id")
      .setDescription("対象セッションID")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("effect")
      .setDescription("エフェクト名")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("mode")
      .setDescription("有効化/無効化")
      .setRequired(true)
      .addChoices(
        { name: "enable", value: MODE_ENABLE },
        { name: "disable", value: MODE_DISABLE },
      ),
  );

export async function execute(interaction) {
  const botOwnerId = process.env.BOT_OWNER_ID?.trim();
  if (!botOwnerId || interaction.user.id !== botOwnerId) {
    return interaction.reply({
      content: "❌ このコマンドはBot管理者のみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sessionId = interaction.options.getString("session_id", true).trim();
  const effectRaw = interaction.options.getString("effect", true);
  const mode = interaction.options.getString("mode", true);
  const value = mode === MODE_ENABLE;

  const effect = normalizeSecretEffect(effectRaw);
  if (!isKnownSecretEffect(effect)) {
    return interaction.editReply({
      content: "❌ 未知の effect です。",
    });
  }

  const session = ActiveSessionDB.findBySessionId(sessionId);
  if (!session) {
    return interaction.editReply({
      content: `❌ セッションが見つかりません: session_id=${sessionId}`,
    });
  }

  if (!session.socket_id) {
    return interaction.editReply({
      content: `❌ セッションは存在しますが、OBSが未接続または切断中です: session_id=${sessionId}`,
    });
  }

  if (!applySecretToSockets([session.socket_id], effect, value)) {
    return interaction.editReply({
      content: "❌ OBS送信機能が初期化されていないため、エフェクトを送信できませんでした。",
    });
  }

  return interaction.editReply({
    content: `✅ secret-admin を適用しました: session_id=${sessionId} effect=${effect} mode=${mode}`,
  });
}
