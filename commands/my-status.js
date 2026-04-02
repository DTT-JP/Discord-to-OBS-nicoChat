import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { GlobalBlacklistDB, GuildSettingDB, LocalBlacklistDB } from "../database.js";

export const data = new SlashCommandBuilder()
  .setName("my-status")
  .setDescription("自分のブラックリスト登録状況を確認します");

export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ このコマンドはサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const userId = interaction.user.id;
  const globalEntry = GlobalBlacklistDB.find(userId);
  if (globalEntry) {
    return interaction.reply({
      content: [
        "あなたはグローバル ブラックリストに入っています",
        "異議申し立てはこちら",
        process.env.GLOBAL_BLACKLIST_APPEAL_URL || "未設定",
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildSetting = GuildSettingDB.find(interaction.guild.id);
  if (!guildSetting.blacklist_status_enabled) {
    return interaction.reply({
      content: "このサーバーではこのコマンドは使用できません",
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildEntry = LocalBlacklistDB.find(userId, interaction.guild.id);
  if (guildEntry) {
    return interaction.reply({
      content: [
        "あなたはギルド ブラックリストに入っています",
        "異議申し立てはこちら",
        guildSetting.blacklist_appeal_url || "未設定",
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    content: "あなたはブラックリストに登録されていません",
    flags: MessageFlags.Ephemeral,
  });
}
