import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { ActiveSessionDB } from "../database.js";
import { getSystemSnapshot } from "../utils/systemMonitor.js";

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Botのシステム状態とアクティブセッション数を表示します");

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;

  const [snapshot, allSessions] = await Promise.all([
    getSystemSnapshot(500),
    Promise.resolve(ActiveSessionDB.findAll()),
  ]);

  const { cpuUsage, memory, uptime } = snapshot;

  // 稼働時間を hh:mm:ss 形式に変換
  const hours     = Math.floor(uptime / 3600);
  const minutes   = Math.floor((uptime % 3600) / 60);
  const seconds   = uptime % 60;
  const uptimeStr = [hours, minutes, seconds]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");

  // CPU 使用率に応じて色を変える
  const color =
    cpuUsage >= 80 ? 0xed4245 :
    cpuUsage >= 50 ? 0xfee75c :
                     0x57f287;

  // ── 実行者自身のセッションのみ詳細表示 ──────────
  const ownSessions   = allSessions.filter((s) => s.user_id === userId);
  const otherCount    = allSessions.length - ownSessions.length;

  const ownSessionText = ownSessions.length === 0
    ? "あなたのアクティブセッションはありません"
    : ownSessions
        .map((s, i) => {
          const elapsed = Math.floor((Date.now() - s.created_at) / 1000);
          const h = Math.floor(elapsed / 3600);
          const m = Math.floor((elapsed % 3600) / 60);
          const sec = elapsed % 60;
          const elapsedStr = [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
          return `${i + 1}. <#${s.channel_id}> （接続時間: ${elapsedStr}）`;
        })
        .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("📊 システムステータス")
    .setColor(color)
    .addFields(
      {
        name:   "🖥️ CPU 使用率",
        value:  `${cpuUsage}%`,
        inline: true,
      },
      {
        name:   "💾 RSS メモリ",
        value:  `${memory.rss} MB`,
        inline: true,
      },
      {
        name:   "🧠 ヒープ使用量",
        value:  `${memory.heapUsed} / ${memory.heapTotal} MB`,
        inline: true,
      },
      {
        name:   "🌐 システムメモリ",
        value:  `${memory.systemUsage}% 使用中`,
        inline: true,
      },
      {
        name:   "⏱️ 稼働時間",
        value:  uptimeStr,
        inline: true,
      },
      {
        name:   "📺 アクティブセッション（全体）",
        value:  `${allSessions.length} 件`,
        inline: true,
      },
      {
        name:   "🔗 あなたのセッション",
        value:  ownSessionText,
        inline: false,
      },
    );

  // 他ユーザーのセッションは件数のみ表示
  if (otherCount > 0) {
    embed.addFields({
      name:   "👥 他ユーザーのセッション",
      value:  `${otherCount} 件（詳細は非公開）`,
      inline: false,
    });
  }

  embed.setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}