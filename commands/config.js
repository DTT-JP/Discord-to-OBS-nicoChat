import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { AllowedPrincipalDB, SetupPrincipalDB } from "../database.js";
import { isAdminOrOwner } from "../utils/moderation.js";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Bot設定を管理します（サーバーオーナー・管理者専用）")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("allow_role")
      .setDescription("/start を許可するロールを追加します")
      .addRoleOption((opt) => opt.setName("role").setDescription("許可するロール").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove_role")
      .setDescription("/start の許可ロールを削除します")
      .addRoleOption((opt) => opt.setName("role").setDescription("削除するロール").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("allow_user")
      .setDescription("/start を許可するユーザーを追加します")
      .addUserOption((opt) => opt.setName("user").setDescription("許可するユーザー").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove_user")
      .setDescription("/start の許可ユーザーを削除します")
      .addUserOption((opt) => opt.setName("user").setDescription("削除するユーザー").setRequired(true)),
  )
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
  .addSubcommand((sub) => sub.setName("list").setDescription("現在の許可リストを表示します"));

export async function execute(interaction) {
  if (!isAdminOrOwner(interaction)) {
    return interaction.reply({
      content: "❌ このコマンドはサーバーオーナーまたは管理者権限を持つユーザーのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();

  if (sub === "allow_role") {
    const role = interaction.options.getRole("role", true);
    await AllowedPrincipalDB.add("role", role.id, guildId);
    return interaction.editReply({ content: `✅ ロール **${role.name}** を /start 許可リストに追加しました。` });
  }
  if (sub === "remove_role") {
    const role = interaction.options.getRole("role", true);
    await AllowedPrincipalDB.remove("role", role.id, guildId);
    return interaction.editReply({ content: `🗑️ ロール **${role.name}** を /start 許可リストから削除しました。` });
  }
  if (sub === "allow_user") {
    const user = interaction.options.getUser("user", true);
    await AllowedPrincipalDB.add("user", user.id, guildId);
    return interaction.editReply({ content: `✅ ユーザー **${user.tag}** を /start 許可リストに追加しました。` });
  }
  if (sub === "remove_user") {
    const user = interaction.options.getUser("user", true);
    await AllowedPrincipalDB.remove("user", user.id, guildId);
    return interaction.editReply({ content: `🗑️ ユーザー **${user.tag}** を /start 許可リストから削除しました。` });
  }
  if (sub === "add_setup_role") {
    const role = interaction.options.getRole("role", true);
    await SetupPrincipalDB.add("role", role.id, guildId);
    return interaction.editReply({ content: `✅ ロール **${role.name}** を /setup 許可リストに追加しました。` });
  }
  if (sub === "del_setup_role") {
    const role = interaction.options.getRole("role", true);
    await SetupPrincipalDB.remove("role", role.id, guildId);
    return interaction.editReply({ content: `🗑️ ロール **${role.name}** を /setup 許可リストから削除しました。` });
  }
  if (sub === "add_setup_user") {
    const user = interaction.options.getUser("user", true);
    await SetupPrincipalDB.add("user", user.id, guildId);
    return interaction.editReply({ content: `✅ ユーザー **${user.tag}** を /setup 許可リストに追加しました。` });
  }
  if (sub === "del_setup_user") {
    const user = interaction.options.getUser("user", true);
    await SetupPrincipalDB.remove("user", user.id, guildId);
    return interaction.editReply({ content: `🗑️ ユーザー **${user.tag}** を /setup 許可リストから削除しました。` });
  }

  const startPrincipals = AllowedPrincipalDB.findByGuild(guildId);
  const setupPrincipals = SetupPrincipalDB.findByGuild(guildId);
  const startRoles = startPrincipals.filter((p) => p.type === "role").map((p) => `<@&${p.id}>`).join("\n") || "なし";
  const startUsers = startPrincipals.filter((p) => p.type === "user").map((p) => `<@${p.id}>`).join("\n") || "なし";
  const setupRoles = setupPrincipals.filter((p) => p.type === "role").map((p) => `<@&${p.id}>`).join("\n") || "なし";
  const setupUsers = setupPrincipals.filter((p) => p.type === "user").map((p) => `<@${p.id}>`).join("\n") || "なし";

  const embed = new EmbedBuilder()
    .setTitle("📋 /config 許可リスト")
    .setColor(0x5865f2)
    .addFields(
      { name: "/start 許可ロール", value: startRoles, inline: true },
      { name: "/start 許可ユーザー", value: startUsers, inline: true },
      { name: "/setup 許可ロール", value: setupRoles, inline: true },
      { name: "/setup 許可ユーザー", value: setupUsers, inline: true },
    )
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
