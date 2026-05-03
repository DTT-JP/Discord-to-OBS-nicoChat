import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { ActiveSessionDB } from "../database.js";
import { getSystemSnapshot } from "../utils/systemMonitor.js";
import { VERSION } from "../utils/version.js";

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Botの稼働状況を表示します")
  .addSubcommand((sub) => sub.setName("show").setDescription("公開向けの簡易ステータス"))
  .addSubcommand((sub) => sub.setName("admin").setDescription("開発者向け詳細ステータス"));

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  const isOwner = !!process.env.BOT_OWNER_ID?.trim() && process.env.BOT_OWNER_ID.trim() === userId;
  const sub = interaction.options.getSubcommand();

  const [snapshot, allSessions] = await Promise.all([
    getSystemSnapshot(500),
    Promise.resolve(ActiveSessionDB.findAll()),
  ]);

  const { cpuUsage, memory, uptime } = snapshot;
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;
  const uptimeStr = [hours, minutes, seconds].map((v) => String(v).padStart(2, "0")).join(":");
  const color = cpuUsage >= 80 ? 0xed4245 : cpuUsage >= 50 ? 0xfee75c : 0x57f287;

  if (sub === "admin") {
    if (!isOwner) return interaction.editReply({ content: "❌ status admin はBOT開発者のみ実行できます。" });
    const guildCount = interaction.client.guilds.cache.size;
    const channelCount = interaction.client.channels.cache.size;
    const embed = new EmbedBuilder()
      .setTitle("📊 システムステータス (Admin)")
      .setColor(color)
      .addFields(
        { name: "🏷️ バージョン", value: `v${VERSION}`, inline: true },
        { name: "⏱️ 稼働時間", value: uptimeStr, inline: true },
        { name: "📺 アクティブセッション", value: `${allSessions.length} 件`, inline: true },
        { name: "🏠 参加サーバー数", value: `${guildCount}`, inline: true },
        { name: "# チャンネル数", value: `${channelCount}`, inline: true },
        { name: "🖥️ CPU", value: `${cpuUsage}%`, inline: true },
        { name: "💾 RSS", value: `${memory.rss} MB`, inline: true },
        { name: "🧠 Heap", value: `${memory.heapUsed} / ${memory.heapTotal} MB`, inline: true },
        { name: "🌐 システムメモリ", value: `${memory.systemUsage}%`, inline: true },
      )
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  }

  const ownSessions = allSessions.filter((s) => s.user_id === userId);
  const embed = new EmbedBuilder()
    .setTitle("✅ BOT稼働中")
    .setColor(color)
    .setDescription([`稼働時間: ${uptimeStr}`, `あなたのセッション: ${ownSessions.length} 件`].join("\n"))
    .setFooter({ text: `v${VERSION}` })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
