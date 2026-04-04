import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from "discord.js";
import { GlobalBlacklistDB, GuildSettingDB, LocalBlacklistDB } from "../database.js";

export const data = new SlashCommandBuilder()
  .setName("my-status")
  .setDescription("自分のブラックリスト登録状況を確認します");

function toDiscordClickableUrl(url) {
  const u = (url ?? "").toString().trim();
  if (!u) return "未設定";
  return `<${u}>`;
}

export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("❌ my-status")
          .setColor(0xed4245)
          .setDescription("このコマンドはサーバー内でのみ実行できます。")
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;
  const globalEntry = GlobalBlacklistDB.find(userId);
  if (globalEntry) {
    const appealUrl = toDiscordClickableUrl(process.env.GLOBAL_BLACKLIST_APPEAL_URL || "");
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🚫 グローバルブラックリスト")
          .setColor(0xed4245)
          .setDescription(
            ["あなたはグローバル ブラックリストに入っています", "異議申し立てはこちら", appealUrl].join("\n"),
          )
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildSetting = GuildSettingDB.find(interaction.guild.id);
  if (!guildSetting.blacklist_status_enabled) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("このサーバーでは利用不可")
          .setColor(0x5865f2)
          .setDescription("このサーバーではこのコマンドは使用できません")
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildEntry = LocalBlacklistDB.find(userId, interaction.guild.id);
  if (guildEntry) {
    const appealUrl = toDiscordClickableUrl(guildSetting.blacklist_appeal_url);
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🚫 ギルドブラックリスト")
          .setColor(0xed4245)
          .setDescription(
            [
              "あなたはギルド ブラックリストに入っています",
              "異議申し立てはこちら",
              appealUrl,
            ].join("\n"),
          )
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("✅ my-status")
        .setColor(0x57f287)
        .setDescription("あなたはブラックリストに登録されていません")
        .setTimestamp(),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
