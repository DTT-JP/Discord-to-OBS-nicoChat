import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { buildAdminStatusEmbed } from "./status.js";
import { isBotOwnerInteraction } from "../utils/botOwner.js";

export const data = new SlashCommandBuilder()
  .setDefaultMemberPermissions(0)
  .setDMPermission(false)
  .setName("status-admin")
  .setDescription("BOT管理者向け詳細ステータスを表示します");

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isBotOwnerInteraction(interaction)) {
    return interaction.editReply({ content: "❌ status-admin はBOT管理者のみ実行できます。" });
  }

  const embed = await buildAdminStatusEmbed(interaction);
  return interaction.editReply({ embeds: [embed] });
}
