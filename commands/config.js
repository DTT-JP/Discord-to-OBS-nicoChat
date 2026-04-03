import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { SetupPrincipalDB } from "../database.js";
import { isAdminOrOwner } from "../utils/moderation.js";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("/setup を実行できるロール・ユーザーを管理します（サーバーオーナー・管理者専用）")
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
      .addUserOption((opt) => opt.setName("user").setDescription("許可するユーザー").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("del_setup_user")
      .setDescription("/setup 実行許可ユーザーを削除します")
      .addUserOption((opt) => opt.setName("user").setDescription("削除するユーザー").setRequired(true)),
  )
  .addSubcommand((sub) => sub.setName("list").setDescription("現在の /setup 実行許可リストを表示します"));

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
    const user = interaction.options.getUser("user", true);
    await SetupPrincipalDB.add("user", user.id, guildId);
    return interaction.editReply({ content: `✅ ユーザー **${user.tag}** を /setup 実行許可に追加しました。` });
  }
  if (sub === "del_setup_user") {
    const user = interaction.options.getUser("user", true);
    await SetupPrincipalDB.remove("user", user.id, guildId);
    return interaction.editReply({ content: `🗑️ ユーザー **${user.tag}** を /setup 実行許可から削除しました。` });
  }

  const setupPrincipals = SetupPrincipalDB.findByGuild(guildId);
  const setupRoles = setupPrincipals.filter((p) => p.type === "role").map((p) => `<@&${p.id}>`).join("\n") || "なし";
  const setupUsers = setupPrincipals.filter((p) => p.type === "user").map((p) => `<@${p.id}>`).join("\n") || "なし";

  const embed = new EmbedBuilder()
    .setTitle("📋 /config — /setup 実行許可")
    .setColor(0x5865f2)
    .setDescription("サーバーオーナー・管理者は常に `/setup` を実行できます。")
    .addFields(
      { name: "/setup 許可ロール", value: setupRoles, inline: true },
      { name: "/setup 許可ユーザー", value: setupUsers, inline: true },
    )
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
