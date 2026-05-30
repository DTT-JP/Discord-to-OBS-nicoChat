import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { ListScope, replyPaginatedList } from "../utils/paginatedList.js";
import { isBotOwnerInteraction } from "../utils/botOwner.js";

export const data = new SlashCommandBuilder()
  .setDefaultMemberPermissions(0)
  .setDMPermission(false)
  .setName("session-admin")
  .setDescription("BOT管理者向けのセッション管理コマンドです")
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("全アクティブセッションを一覧表示します")
      .addIntegerOption((opt) =>
        opt
          .setName("page")
          .setDescription("表示するページ番号")
          .setMinValue(1)
          .setRequired(false),
      ),
  );

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isBotOwnerInteraction(interaction)) {
    return interaction.editReply({ content: "❌ session-admin はBOT管理者のみ実行できます。" });
  }

  const sub = interaction.options.getSubcommand();
  if (sub === "list") {
    return replyPaginatedList(interaction, ListScope.SESSION_ADMIN, "global");
  }

  return interaction.editReply({ content: "❌ 未対応のサブコマンドです。" });
}
