import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { GlobalGuildBlacklistDB } from "../database.js";
import { parseDurationValueAndUnit } from "../utils/blacklistDuration.js";
import { formatDateTime, formatRemaining } from "../utils/moderation.js";
import { ListScope, replyPaginatedList } from "../utils/paginatedList.js";

function isBotOwner(interaction) {
  const ownerId = process.env.BOT_OWNER_ID?.trim();
  return ownerId && interaction.user.id === ownerId;
}

function parseGuildId(interaction) {
  const guildId = interaction.options.getString("guild_id", true).trim();
  if (!/^\d{17,20}$/.test(guildId)) return { error: "❌ ギルドIDの形式が正しくありません（17〜20桁の数字）" };
  return { guildId };
}

function buildGuildDm(guildName, entry) {
  const appealUrl = process.env.GLOBAL_GUILD_BLACKLIST_APPEAL_URL?.trim();
  const appealLine = appealUrl ? `異議申し立てはこちら: ${appealUrl}` : "異議申し立てはこちら: (URL未設定)";
  const publicReason = entry.public_reason?.trim() ? entry.public_reason.trim() : "（理由なし）";
  const expiresText = entry.expires_at == null ? "無期限" : formatDateTime(entry.expires_at);
  return [
    "このサーバーではこのBOTは使えません。",
    `このBOTはサーバー（${guildName}）から退出しました。`,
    `理由: ${publicReason}`,
    `期限: ${expiresText}`,
    appealLine,
  ].join("\n");
}

export const data = new SlashCommandBuilder()
  .setName("global_guild_blacklist")
  .setDescription("グローバルギルドブラックリストを管理します（Bot管理者のみ）")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("ギルドをグローバルブラックリストに追加")
      .addStringOption((opt) => opt.setName("guild_id").setDescription("対象ギルドID").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("public_reason").setDescription("公開向け理由（DMに表示）").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("internal_reason").setDescription("内部理由（管理用）").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("duration_value").setDescription("期間の数値／無制限は infinity").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("duration_unit")
          .setDescription("単位（無制限は両方 infinity）")
          .setRequired(true)
          .addChoices(
            { name: "分", value: "minute" },
            { name: "時間", value: "hour" },
            { name: "日", value: "day" },
            { name: "週", value: "week" },
            { name: "月(30日)", value: "month" },
            { name: "年", value: "year" },
            { name: "無制限（値も infinity）", value: "infinity" },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("ギルドをグローバルブラックリストから削除")
      .addStringOption((opt) => opt.setName("guild_id").setDescription("対象ギルドID").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("グローバルギルドブラックリストを表示（10件/ページ）")
      .addIntegerOption((opt) =>
        opt.setName("page").setDescription("表示するページ（1から）").setMinValue(1).setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("特定ギルドの詳細を表示")
      .addStringOption((opt) => opt.setName("guild_id").setDescription("対象ギルドID").setRequired(true)),
  );

export async function execute(interaction) {
  if (!process.env.BOT_OWNER_ID?.trim()) {
    return interaction.reply({
      content: "❌ `BOT_OWNER_ID` が `.env` に設定されていません。",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!isBotOwner(interaction)) {
    return interaction.reply({
      content: "❌ このコマンドはBot製作者のみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === "add") {
    const gid = parseGuildId(interaction);
    if (gid.error) return interaction.editReply({ content: gid.error });

    const publicReason = interaction.options.getString("public_reason", true);
    const internalReason = interaction.options.getString("internal_reason", true);

    const dur = parseDurationValueAndUnit(interaction);
    if (dur.error) return interaction.editReply({ content: dur.error });
    const expiresAt = dur.expiresAt;

    const added = await GlobalGuildBlacklistDB.add(
      gid.guildId,
      interaction.user.id,
      publicReason,
      internalReason,
      expiresAt,
    );
    // 既に登録されていても上書きはせず、（BOTが参加済みなら）DM＋退出だけ保証する

    const guild =
      interaction.client.guilds.cache.get(gid.guildId) ??
      (await interaction.client.guilds.fetch(gid.guildId).catch(() => null));

    const ownerId = guild?.ownerId;
    const existingEntry = await GlobalGuildBlacklistDB.find(gid.guildId);

    const responsePublicReason = existingEntry?.public_reason?.trim()
      ? existingEntry.public_reason.trim()
      : publicReason;
    const responseExpiresAt = existingEntry?.expires_at ?? expiresAt;

    if (guild && ownerId && existingEntry) {
      const owner = await interaction.client.users.fetch(ownerId).catch(() => null);
      await guild.leave().catch(() => {});
      if (owner) await owner.send(buildGuildDm(guild.name, existingEntry)).catch(() => {});
    }

    // 参加中のギルドなら即時にオーナーへDM
    return interaction.editReply({
      content: [
        added
          ? `🚫 ギルド \`${gid.guildId}\` をグローバルギルドブラックリストに追加しました。`
          : `ℹ️ ギルド \`${gid.guildId}\` は既にグローバルギルドブラックリストに登録済みです（上書きしません）。`,
        guild ? "DM送信と退出を実行しました。" : "（このボットが未参加だったため退出は行いません）",
        `公開向け理由（登録値）: ${responsePublicReason}`,
        `残り期間（登録値）: ${formatRemaining(responseExpiresAt)}`,
      ].join("\n"),
    });
  }

  if (sub === "remove") {
    const gid = parseGuildId(interaction);
    if (gid.error) return interaction.editReply({ content: gid.error });

    const removed = await GlobalGuildBlacklistDB.remove(gid.guildId);
    if (!removed) return interaction.editReply({ content: `⚠️ ギルド \`${gid.guildId}\` は登録されていません。` });
    return interaction.editReply({ content: `✅ ギルド \`${gid.guildId}\` をグローバルギルドブラックリストから削除しました。` });
  }

  if (sub === "list") {
    return replyPaginatedList(interaction, ListScope.GLOBAL_GUILD_BL, "global");
  }

  if (sub === "show") {
    const gid = parseGuildId(interaction);
    if (gid.error) return interaction.editReply({ content: gid.error });

    const entry = GlobalGuildBlacklistDB.find(gid.guildId);
    if (!entry) {
      return interaction.editReply({ content: `ℹ️ \`${gid.guildId}\` はグローバルギルドブラックリストに登録されていません。` });
    }

    const guild =
      interaction.client.guilds.cache.get(gid.guildId) ??
      (await interaction.client.guilds.fetch(gid.guildId).catch(() => null));
    const guildName = guild?.name ?? "(不明)";

    const embed = new EmbedBuilder()
      .setTitle("🔎 global_guild_blacklist_show")
      .setColor(0xed4245)
      .addFields(
        { name: "ギルドID", value: entry.guild_id, inline: true },
        { name: "名前", value: guildName, inline: true },
        { name: "施行日時", value: formatDateTime(entry.added_at), inline: true },
        { name: "追加者", value: `<@${entry.added_by}>`, inline: true },
        { name: "公開向け理由", value: entry.public_reason || "(理由なし)", inline: false },
        { name: "内部理由", value: entry.internal_reason || "(理由なし)", inline: false },
        { name: "残り期限", value: formatRemaining(entry.expires_at), inline: true },
        { name: "設定期限", value: formatDateTime(entry.expires_at), inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  return interaction.editReply({ content: "❌ 不明なサブコマンドです。" });
}

