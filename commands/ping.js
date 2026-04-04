import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Botとの応答速度とレイテンシを表示します");

export async function execute(interaction) {
  const sentAt = Date.now();

  // まずプレースホルダーメッセージを送って round-trip を測る
  const reply = await interaction.reply({
    content: "🏓 ping...",
    flags: MessageFlags.Ephemeral,
    fetchReply: true,
  });

  const repliedAt = Date.now();

  const wsPing = interaction.client.ws.ping; // Discord WebSocket の平均 ping (ms)
  const apiLatency = repliedAt - sentAt;     // Slash コマンド → Reply までの往復レイテンシ

  const createdTimestamp =
    typeof reply.createdTimestamp === "number" ? reply.createdTimestamp : repliedAt;
  const messageLatency = createdTimestamp - interaction.createdTimestamp;

  const embed = new EmbedBuilder()
    .setTitle("🏓 Pong!")
    .setColor(0x57f287)
    .setDescription("Bot の現在のレイテンシ情報です。")
    .addFields(
      {
        name: "⌛ コマンド応答時間",
        value: `${apiLatency} ms`,
        inline: true,
      },
      {
        name: "📨 メッセージレイテンシ",
        value: `${messageLatency} ms`,
        inline: true,
      },
      {
        name: "🌐 WebSocket Ping",
        value: `${Number.isFinite(wsPing) ? wsPing : "N/A"} ms`,
        inline: true,
      },
    )
    .setTimestamp();

  return interaction.editReply({ content: "", embeds: [embed] });
}

