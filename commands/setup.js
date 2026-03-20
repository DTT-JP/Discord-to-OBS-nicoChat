import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { AllowedPrincipalDB } from "../database.js";

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Botの設定を管理します（サーバーオーナー専用）")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  // allow_role
  .addSubcommand((sub) =>
    sub
      .setName("allow_role")
      .setDescription("/start を許可するロールを追加します")
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("許可するロール").setRequired(true),
      ),
  )
  // remove_role
  .addSubcommand((sub) =>
    sub
      .setName("remove_role")
      .setDescription("/start の許可ロールを削除します")
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("削除するロール").setRequired(true),
      ),
  )
  // allow_user
  .addSubcommand((sub) =>
    sub
      .setName("allow_user")
      .setDescription("/start を許可するユーザーを追加します")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("許可するユーザー").setRequired(true),
      ),
  )
  // remove_user
  .addSubcommand((sub) =>
    sub
      .setName("remove_user")
      .setDescription("/start の許可ユーザーを削除します")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("削除するユーザー").setRequired(true),
      ),
  )
  // list
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("現在の許可リストを表示します"),
  );

export async function execute(interaction) {
  // ── サーバーオーナー限定 ──────────────────────
  if (interaction.user.id !== interaction.guild.ownerId) {
    return interaction.reply({
      content: "❌ このコマンドはサーバーオーナーのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id; // ← 全操作でギルドIDを使用

  // ── allow_role ───────────────────────────────
  if (sub === "allow_role") {
    const role = interaction.options.getRole("role", true);
    await AllowedPrincipalDB.add("role", role.id, guildId);
    return interaction.editReply({
      content: `✅ ロール **${role.name}** を /start 許可リストに追加しました。`,
    });
  }

  // ── remove_role ──────────────────────────────
  if (sub === "remove_role") {
    const role = interaction.options.getRole("role", true);
    await AllowedPrincipalDB.remove("role", role.id, guildId);
    return interaction.editReply({
      content: `🗑️ ロール **${role.name}** を /start 許可リストから削除しました。`,
    });
  }

  // ── allow_user ───────────────────────────────
  if (sub === "allow_user") {
    const user = interaction.options.getUser("user", true);
    await AllowedPrincipalDB.add("user", user.id, guildId);
    return interaction.editReply({
      content: `✅ ユーザー **${user.tag}** を /start 許可リストに追加しました。`,
    });
  }

  // ── remove_user ──────────────────────────────
  if (sub === "remove_user") {
    const user = interaction.options.getUser("user", true);
    await AllowedPrincipalDB.remove("user", user.id, guildId);
    return interaction.editReply({
      content: `🗑️ ユーザー **${user.tag}** を /start 許可リストから削除しました。`,
    });
  }

  // ── list ─────────────────────────────────────
  if (sub === "list") {
    const principals = AllowedPrincipalDB.findByGuild(guildId); // ← guild_id で絞り込み

    if (principals.length === 0) {
      return interaction.editReply({
        content: "📋 このサーバーの許可リストは空です。`/setup allow_role` または `/setup allow_user` で追加してください。",
      });
    }

    const roles = principals
      .filter((p) => p.type === "role")
      .map((p) => `<@&${p.id}>`)
      .join("\n") || "なし";

    const users = principals
      .filter((p) => p.type === "user")
      .map((p) => `<@${p.id}>`)
      .join("\n") || "なし";

    const embed = new EmbedBuilder()
      .setTitle("📋 /start 許可リスト")
      .setColor(0x5865f2)
      .addFields(
        { name: "許可ロール", value: roles, inline: true },
        { name: "許可ユーザー", value: users, inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
}