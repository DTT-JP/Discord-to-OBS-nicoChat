import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { SetupPrincipalDB, BlacklistCtrlPrincipalDB } from "../database.js";
import { isAdminOrOwner, parseTargetUser, formatUserTagForReply } from "../utils/moderation.js";
import { ListScope, replyPaginatedList } from "../utils/paginatedList.js";

function pageOpt(sub) {
  return sub.addIntegerOption((opt) =>
    opt.setName("page").setDescription("表示するページ（1から）").setMinValue(1).setRequired(false),
  );
}

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("/setup・/blacklist 操作権限を管理します（サーバーオーナー・管理者専用）")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("add_setup_role")
      .setDescription("/setup 実行を許可するロールを追加します")
      .addRoleOption((opt) => opt.setName("role").setDescription("許可するロール").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("del_setup_role")
      .setDescription("/setup 実行許可ロールを削除します")
      .addRoleOption((opt) => opt.setName("role").setDescription("削除するロール").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("add_setup_user")
      .setDescription("/setup 実行を許可するユーザーを追加します")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("許可するユーザー（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("同上・17〜20桁のユーザーID（どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("del_setup_user")
      .setDescription("/setup 実行許可ユーザーを削除します")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("削除するユーザー（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("同上・ユーザーID（どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    pageOpt(
      sub
        .setName("setup_role_list")
        .setDescription("/setup 実行許可ロール一覧（10件/ページ）"),
    ),
  )
  .addSubcommand((sub) =>
    pageOpt(
      sub
        .setName("setup_user_list")
        .setDescription("/setup 実行許可ユーザー一覧（10件/ページ）"),
    ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ctrl_blacklist_role")
      .setDescription("/blacklist を実行できるロールを追加します")
      .addRoleOption((opt) => opt.setName("role").setDescription("許可するロール").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove_ctrl_blacklist_role")
      .setDescription("/blacklist 操作許可ロールを削除します")
      .addRoleOption((opt) => opt.setName("role").setDescription("削除するロール").setRequired(true)),
  )
  .addSubcommand((sub) =>
    pageOpt(
      sub
        .setName("ctrl_blacklist_role_list")
        .setDescription("/blacklist 操作許可ロール一覧（10件/ページ）"),
    ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ctrl_blacklist_user")
      .setDescription("/blacklist を実行できるユーザーを追加します")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("許可するユーザー（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("同上・ユーザーID（どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove_ctrl_blacklist_user")
      .setDescription("/blacklist 操作許可ユーザーを削除します")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("削除するユーザー（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("同上・ユーザーID（どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    pageOpt(
      sub
        .setName("ctrl_blacklist_user_list")
        .setDescription("/blacklist 操作許可ユーザー一覧（10件/ページ）"),
    ),
  );

export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ このコマンドはサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!isAdminOrOwner(interaction)) {
    return interaction.reply({
      content: "❌ このコマンドはサーバーオーナー、または管理者権限（Administrator）を持つユーザーのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();

  if (sub === "add_setup_role") {
    const role = interaction.options.getRole("role", true);
    await SetupPrincipalDB.add("role", role.id, guildId);
    return interaction.editReply({ content: `✅ ロール **${role.name}** を /setup 実行許可に追加しました。` });
  }
  if (sub === "del_setup_role") {
    const role = interaction.options.getRole("role", true);
    await SetupPrincipalDB.remove("role", role.id, guildId);
    return interaction.editReply({ content: `🗑️ ロール **${role.name}** を /setup 実行許可から削除しました。` });
  }
  if (sub === "add_setup_user") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });
    await SetupPrincipalDB.add("user", target.userId, guildId);
    const label = await formatUserTagForReply(interaction.client, target);
    return interaction.editReply({ content: `✅ ユーザー **${label}** を /setup 実行許可に追加しました。` });
  }
  if (sub === "del_setup_user") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });
    await SetupPrincipalDB.remove("user", target.userId, guildId);
    const label = await formatUserTagForReply(interaction.client, target);
    return interaction.editReply({ content: `🗑️ ユーザー **${label}** を /setup 実行許可から削除しました。` });
  }

  if (sub === "ctrl_blacklist_role") {
    const role = interaction.options.getRole("role", true);
    await BlacklistCtrlPrincipalDB.add("role", role.id, guildId);
    return interaction.editReply({ content: `✅ ロール **${role.name}** を /blacklist 操作許可に追加しました。` });
  }
  if (sub === "remove_ctrl_blacklist_role") {
    const role = interaction.options.getRole("role", true);
    await BlacklistCtrlPrincipalDB.remove("role", role.id, guildId);
    return interaction.editReply({ content: `🗑️ ロール **${role.name}** を /blacklist 操作許可から削除しました。` });
  }
  if (sub === "ctrl_blacklist_user") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });
    await BlacklistCtrlPrincipalDB.add("user", target.userId, guildId);
    const label = await formatUserTagForReply(interaction.client, target);
    return interaction.editReply({ content: `✅ ユーザー **${label}** を /blacklist 操作許可に追加しました。` });
  }
  if (sub === "remove_ctrl_blacklist_user") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });
    await BlacklistCtrlPrincipalDB.remove("user", target.userId, guildId);
    const label = await formatUserTagForReply(interaction.client, target);
    return interaction.editReply({ content: `🗑️ ユーザー **${label}** を /blacklist 操作許可から削除しました。` });
  }

  if (sub === "setup_role_list") return replyPaginatedList(interaction, ListScope.CONFIG_SETUP_ROLE);
  if (sub === "setup_user_list") return replyPaginatedList(interaction, ListScope.CONFIG_SETUP_USER);
  if (sub === "ctrl_blacklist_role_list") {
    return replyPaginatedList(interaction, ListScope.CONFIG_BL_CTRL_ROLE);
  }
  if (sub === "ctrl_blacklist_user_list") {
    return replyPaginatedList(interaction, ListScope.CONFIG_BL_CTRL_USER);
  }

  return interaction.editReply({ content: "❌ 不明なサブコマンドです。" });
}
