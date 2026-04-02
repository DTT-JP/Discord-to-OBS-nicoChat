import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { GlobalBlacklistDB } from "../database.js";

export const data = new SlashCommandBuilder()
  .setName("global_blacklist")
  .setDescription("グローバルブラックリストを管理します（Bot製作者専用）")
  // add
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("ユーザーをグローバルブラックリストに追加します（全サーバー・全OBS共通遮断）")
      .addStringOption((opt) =>
        opt
          .setName("user_id")
          .setDescription("対象ユーザーのDiscord ID（17〜20桁の数字）")
          .setRequired(true),
      ),
  )
  // remove
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("ユーザーをグローバルブラックリストから削除します")
      .addStringOption((opt) =>
        opt
          .setName("user_id")
          .setDescription("対象ユーザーのDiscord ID")
          .setRequired(true),
      ),
  )
  // list
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("グローバルブラックリストを表示します"),
  );

export async function execute(interaction) {
  // ── Bot製作者のみ実行可能 ─────────────────────
  const ownerId = process.env.BOT_OWNER_ID?.trim();

  if (!ownerId) {
    return interaction.reply({
      content: "❌ `BOT_OWNER_ID` が `.env` に設定されていません。Bot管理者に連絡してください。",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: "❌ このコマンドはBot製作者のみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sub = interaction.options.getSubcommand();

  // ── add ──────────────────────────────────────
  if (sub === "add") {
    const userId = interaction.options.getString("user_id", true).trim();

    if (!/^\d{17,20}$/.test(userId)) {
      return interaction.editReply({
        content: "❌ ユーザーIDの形式が正しくありません（17〜20桁の数字）。",
      });
    }

    const added = await GlobalBlacklistDB.add(userId, interaction.user.id);
    if (!added) {
      return interaction.editReply({
        content: `⚠️ ユーザーID \`${userId}\` はすでにグローバルブラックリストに登録されています。`,
      });
    }

    return interaction.editReply({
      content: `🚫 ユーザーID \`${userId}\` をグローバルブラックリストに追加しました。\n全サーバーでコマンドへの反応とOBSへの表示が遮断されます。`,
    });
  }

  // ── remove ────────────────────────────────────
  if (sub === "remove") {
    const userId = interaction.options.getString("user_id", true).trim();
    const removed = await GlobalBlacklistDB.remove(userId);

    if (!removed) {
      return interaction.editReply({
        content: `⚠️ ユーザーID \`${userId}\` はグローバルブラックリストに登録されていません。`,
      });
    }

    return interaction.editReply({
      content: `✅ ユーザーID \`${userId}\` をグローバルブラックリストから削除しました。`,
    });
  }

  // ── list ─────────────────────────────────────
  if (sub === "list") {
    const entries = GlobalBlacklistDB.findAll();

    if (entries.length === 0) {
      return interaction.editReply({ content: "📋 グローバルブラックリストは空です。" });
    }

    const lines = entries.map((e, i) => {
      const date = new Date(e.added_at).toLocaleDateString("ja-JP");
      return `${i + 1}. \`${e.user_id}\` — 追加日: ${date} / 追加者: <@${e.added_by}>`;
    });

    const embed = new EmbedBuilder()
      .setTitle("🚫 グローバルブラックリスト")
      .setColor(0xed4245)
      .setDescription(lines.join("\n"))
      .setFooter({ text: "このリストは全サーバー・全OBSに共通して適用されます" })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
}
