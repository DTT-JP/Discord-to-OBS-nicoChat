import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { LocalBlacklistDB } from "../database.js";

/**
 * サーバーオーナーまたは管理者権限を持つか判定
 * @param {import("discord.js").Interaction} interaction
 * @returns {boolean}
 */
function isAdminOrOwner(interaction) {
  if (interaction.user.id === interaction.guild?.ownerId) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

export const data = new SlashCommandBuilder()
  .setName("blacklist")
  .setDescription("このサーバーのブラックリストを管理します（サーバーオーナー・管理者専用）")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  // add
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("ユーザーをこのサーバーのブラックリストに追加します")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("対象ユーザー（@メンション）")
          .setRequired(false),
      )
      .addStringOption((opt) =>
        opt
          .setName("user_id")
          .setDescription("対象ユーザーのDiscord ID（サーバーにいない場合はこちら）")
          .setRequired(false),
      ),
  )
  // remove
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("ユーザーをこのサーバーのブラックリストから削除します")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("対象ユーザー（@メンション）")
          .setRequired(false),
      )
      .addStringOption((opt) =>
        opt
          .setName("user_id")
          .setDescription("対象ユーザーのDiscord ID")
          .setRequired(false),
      ),
  )
  // list
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("このサーバーのブラックリストを表示します"),
  );

export async function execute(interaction) {
  // ── サーバーオーナーまたは管理者のみ ──────────
  if (!isAdminOrOwner(interaction)) {
    return interaction.reply({
      content: "❌ このコマンドはサーバーオーナーまたは管理者権限を持つユーザーのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  // DM では実行不可
  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ このコマンドはサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  // ── add ──────────────────────────────────────
  if (sub === "add") {
    const user   = interaction.options.getUser("user", false);
    const rawId  = interaction.options.getString("user_id", false)?.trim();
    const userId = user?.id ?? rawId;

    if (!userId) {
      return interaction.editReply({
        content: "❌ `user` または `user_id` のどちらかを指定してください。",
      });
    }

    if (!/^\d{17,20}$/.test(userId)) {
      return interaction.editReply({
        content: "❌ ユーザーIDの形式が正しくありません（17〜20桁の数字）。",
      });
    }

    const added = await LocalBlacklistDB.add(userId, guildId, interaction.user.id);
    if (!added) {
      return interaction.editReply({
        content: `⚠️ <@${userId}> はすでにこのサーバーのブラックリストに登録されています。`,
      });
    }

    return interaction.editReply({
      content: `🚫 <@${userId}> をこのサーバーのブラックリストに追加しました。\nこのサーバー内での発言はOBS/ブラウザオーバーレイに表示されなくなります。`,
    });
  }

  // ── remove ────────────────────────────────────
  if (sub === "remove") {
    const user   = interaction.options.getUser("user", false);
    const rawId  = interaction.options.getString("user_id", false)?.trim();
    const userId = user?.id ?? rawId;

    if (!userId) {
      return interaction.editReply({
        content: "❌ `user` または `user_id` のどちらかを指定してください。",
      });
    }

    const removed = await LocalBlacklistDB.remove(userId, guildId);
    if (!removed) {
      return interaction.editReply({
        content: `⚠️ <@${userId}> はこのサーバーのブラックリストに登録されていません。`,
      });
    }

    return interaction.editReply({
      content: `✅ <@${userId}> をこのサーバーのブラックリストから削除しました。`,
    });
  }

  // ── list ─────────────────────────────────────
  if (sub === "list") {
    const entries = LocalBlacklistDB.findByGuild(guildId);

    if (entries.length === 0) {
      return interaction.editReply({ content: "📋 このサーバーのブラックリストは空です。" });
    }

    const lines = entries.map((e, i) => {
      const date = new Date(e.added_at).toLocaleDateString("ja-JP");
      return `${i + 1}. <@${e.user_id}> (\`${e.user_id}\`) — 追加日: ${date} / 追加者: <@${e.added_by}>`;
    });

    const embed = new EmbedBuilder()
      .setTitle("🚫 サーバーブラックリスト")
      .setColor(0xed4245)
      .setDescription(lines.join("\n"))
      .setFooter({ text: "このリストはこのサーバー内でのみ適用されます" })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
}
