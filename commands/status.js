import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { ActiveSessionDB, AllowedPrincipalDB } from "../database.js";
import { getSystemSnapshot } from "../utils/systemMonitor.js";
import { VERSION } from "../utils/version.js";

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Botのシステム状態とアクティブセッション数を表示します");

export async function execute(interaction) {
  // ── setup で許可されたロール/ユーザーのみ実行可能 ──
  const member = interaction.member;
  if (!AllowedPrincipalDB.isAllowed(member)) {
    return interaction.reply({
      content: "❌ このコマンドを実行する権限がありません。\nサーバーオーナーに `/setup allow_role` または `/setup allow_user` での許可を依頼してください。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;

  const [snapshot, allSessions] = await Promise.all([
    getSystemSnapshot(500),
    Promise.resolve(ActiveSessionDB.findAll()),
  ]);

  const { cpuUsage, memory, uptime } = snapshot;

  const hours   = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;
  const uptimeStr = [hours, minutes, seconds]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");

  const color =
    cpuUsage >= 80 ? 0xed4245 :
    cpuUsage >= 50 ? 0xfee75c :
                     0x57f287;

  const ownSessions  = allSessions.filter((s) => s.user_id === userId);
  const otherCount   = allSessions.length - ownSessions.length;

  const ownSessionText = ownSessions.length === 0
    ? "アクティブなセッションはありません"
    : ownSessions
        .map((s, i) => {
          const elapsed    = Math.floor((Date.now() - s.created_at) / 1000);
          const h          = Math.floor(elapsed / 3600);
          const m          = Math.floor((elapsed % 3600) / 60);
          const sec        = elapsed % 60;
          const elapsedStr = [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
          return `${i + 1}. <#${s.channel_id}> （接続時間: ${elapsedStr} / 上限: ${s.max_comments}件）`;
        })
        .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("📊 システムステータス")
    .setColor(color)
    .addFields(
      { name: "🏷️ バージョン",             value: `v${VERSION}`,                                    inline: true  },
      { name: "⏱️ 稼働時間",               value: uptimeStr,                                        inline: true  },
      { name: "📺 アクティブセッション",    value: `${allSessions.length} 件`,                      inline: true  },
      { name: "🖥️ CPU 使用率",             value: `${cpuUsage}%`,                                   inline: true  },
      { name: "💾 RSS メモリ",              value: `${memory.rss} MB`,                               inline: true  },
      { name: "🧠 ヒープ使用量",           value: `${memory.heapUsed} / ${memory.heapTotal} MB`,    inline: true  },
      { name: "🌐 システムメモリ",          value: `${memory.systemUsage}% 使用中`,                  inline: true  },
      { name: "🔗 あなたのセッション",      value: ownSessionText,                                   inline: false },
    );

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
