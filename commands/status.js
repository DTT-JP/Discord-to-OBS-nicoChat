import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { ActiveSessionDB } from "../database.js";
import { getSystemSnapshot } from "../utils/systemMonitor.js";
import { VERSION } from "../utils/version.js";
import { isBotOwnerInteraction } from "../utils/botOwner.js";

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Botの稼働状況を表示します");

function formatUptime(uptime) {
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;
  return [hours, minutes, seconds].map((v) => String(v).padStart(2, "0")).join(":");
}

function getStatusColor(cpuUsage) {
  return cpuUsage >= 80 ? 0xed4245 : cpuUsage >= 50 ? 0xfee75c : 0x57f287;
}

export async function buildPublicStatusEmbed(userId) {
  const [snapshot, allSessions] = await Promise.all([
    getSystemSnapshot(500),
    Promise.resolve(ActiveSessionDB.findAll()),
  ]);

  const uptimeStr = formatUptime(snapshot.uptime);
  const ownSessions = allSessions.filter((s) => s.user_id === userId);

  return new EmbedBuilder()
    .setTitle("✅ BOT稼働中")
    .setColor(getStatusColor(snapshot.cpuUsage))
    .setDescription([`稼働時間: ${uptimeStr}`, `あなたのセッション: ${ownSessions.length} 件`].join("\n"))
    .setFooter({ text: `v${VERSION}` })
    .setTimestamp();
}

export async function buildAdminStatusEmbed(interaction) {
  const [snapshot, allSessions] = await Promise.all([
    getSystemSnapshot(500),
    Promise.resolve(ActiveSessionDB.findAll()),
  ]);

  const { cpuUsage, memory, uptime } = snapshot;
  const uptimeStr = formatUptime(uptime);
  const guildCount = interaction.client.guilds.cache.size;
  const channelCount = interaction.client.channels.cache.size;

  return new EmbedBuilder()
    .setTitle("📊 システムステータス (Admin)")
    .setColor(getStatusColor(cpuUsage))
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
}

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // 旧 `/status admin` 定義がDiscord側に残っている間も詳細ステータスを返せるようにする。
  const sub = interaction.options.getSubcommand(false);
  if (sub === "admin") {
    if (!isBotOwnerInteraction(interaction)) {
      return interaction.editReply({ content: "❌ status admin はBOT管理者のみ実行できます。" });
    }
    const embed = await buildAdminStatusEmbed(interaction);
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = await buildPublicStatusEmbed(interaction.user.id);
  return interaction.editReply({ embeds: [embed] });
}
