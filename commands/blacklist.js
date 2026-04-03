import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { LocalBlacklistDB, GuildSettingDB, BlacklistCtrlPrincipalDB } from "../database.js";
import {
  isAdminOrOwner,
  parseTargetUser,
  formatRemaining,
  formatDateTime,
  formatUserTagForReply,
} from "../utils/moderation.js";
import { parseDurationValueAndUnit } from "../utils/blacklistDuration.js";
import { ListScope, replyPaginatedList } from "../utils/paginatedList.js";

function canManageBlacklist(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  if (isAdminOrOwner(interaction)) return true;
  return BlacklistCtrlPrincipalDB.isAllowed(interaction.member);
}

function pageOpt(sub) {
  return sub.addIntegerOption((opt) =>
    opt.setName("page").setDescription("表示するページ（1から）").setMinValue(1).setRequired(false),
  );
}

/**
 * @param {string} raw
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function validateAppealUrl(raw) {
  if (!raw) return { ok: true, value: "" };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "❌ `appeal_url` は有効なURLを指定してください（http:// または https://）。" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "❌ `appeal_url` は http:// または https:// で始まるURLのみ指定できます。" };
  }
  return { ok: true, value: u.toString() };
}

export const data = new SlashCommandBuilder()
  .setName("blacklist")
  .setDescription("このサーバーのブラックリストと照会設定を管理します")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("ユーザーをこのサーバーのブラックリストに追加します")
      .addStringOption((opt) => opt.setName("reason").setDescription("理由").setRequired(true))
      .addStringOption((opt) =>
        opt
          .setName("duration_value")
          .setDescription("期間の数値（例: 7）／無制限は英字 infinity")
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("duration_unit")
          .setDescription("単位（無制限は duration_value も含め両方 infinity）")
          .setRequired(true)
          .addChoices(
            { name: "分", value: "minute" },
            { name: "時間", value: "hour" },
            { name: "日", value: "day" },
            { name: "週", value: "week" },
            { name: "月(30日)", value: "month" },
            { name: "年", value: "year" },
            { name: "無制限（値も infinity にする）", value: "infinity" },
          ),
      )
      .addUserOption((opt) =>
        opt.setName("user").setDescription("対象（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("対象のユーザーID・数字（@の代わり、どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("ユーザーをこのサーバーのブラックリストから削除します")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("対象（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("対象のユーザーID（どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    pageOpt(sub.setName("list").setDescription("このサーバーのブラックリスト一覧（10件/ページ）")),
  )
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("このサーバーのブラックリスト登録詳細を表示します")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("対象（@メンション）").setRequired(false),
      )
      .addStringOption((opt) =>
        opt.setName("user_id").setDescription("対象のユーザーID（どちらか必須）").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("config")
      .setDescription("/my-status 照会の可否とサーバーBLの異議申し立て先URLを設定")
      .addBooleanOption((opt) => opt.setName("enabled").setDescription("照会を有効にするか").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("appeal_url").setDescription("異議申し立て先URL（enabled=true 時推奨）").setRequired(false),
      ),
  )
  .addSubcommand((sub) => sub.setName("config_show").setDescription("上記 config の現在値を表示"));

export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: "❌ このコマンドはサーバー内でのみ実行できます。", flags: MessageFlags.Ephemeral });
  }

  if (!canManageBlacklist(interaction)) {
    return interaction.reply({
      content:
        "❌ このコマンドはサーバーオーナー・管理者、または `/config` の `ctrl_blacklist_*` で許可されたユーザーのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (sub === "config_show") {
    const gs = GuildSettingDB.find(guildId);
    const embed = new EmbedBuilder()
      .setTitle("⚙️ /blacklist config — 現在の値")
      .setColor(0x5865f2)
      .addFields(
        { name: "/my-status 照会", value: gs.blacklist_status_enabled ? "有効" : "無効", inline: true },
        { name: "異議申し立てURL", value: gs.blacklist_appeal_url?.trim() ? gs.blacklist_appeal_url : "未設定", inline: false },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === "add") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });

    const reason = interaction.options.getString("reason", true);
    const dur = parseDurationValueAndUnit(interaction);
    if (dur.error) return interaction.editReply({ content: dur.error });
    const expiresAt = dur.expiresAt;
    const added = await LocalBlacklistDB.add(target.userId, guildId, interaction.user.id, reason, expiresAt);
    const label = await formatUserTagForReply(interaction.client, target);
    if (!added) return interaction.editReply({ content: `⚠️ **${label}**（<@${target.userId}>）はすでに登録されています。` });

    return interaction.editReply({
      content: [
        `🚫 **${label}**（<@${target.userId}>）をサーバーブラックリストに追加しました。`,
        `理由: ${reason}`,
        `残り期間: ${formatRemaining(expiresAt)}`,
      ].join("\n"),
    });
  }

  if (sub === "remove") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });
    const label = await formatUserTagForReply(interaction.client, target);
    const removed = await LocalBlacklistDB.remove(target.userId, guildId);
    if (!removed) {
      return interaction.editReply({ content: `⚠️ **${label}**（<@${target.userId}>）は登録されていません。` });
    }
    return interaction.editReply({
      content: `✅ **${label}**（<@${target.userId}>）をサーバーブラックリストから削除しました。`,
    });
  }

  if (sub === "list") return replyPaginatedList(interaction, ListScope.BLACKLIST_ENTRIES);
  if (sub === "show") {
    const target = parseTargetUser(interaction);
    if (target.error) return interaction.editReply({ content: target.error });

    const entry = LocalBlacklistDB.find(target.userId, guildId);
    if (!entry) {
      return interaction.editReply({
        content: `ℹ️ \`${target.userId}\` はこのサーバーのブラックリストに登録されていません。`,
      });
    }

    const displayUser = target.user ?? (await interaction.client.users.fetch(target.userId).catch(() => null));
    const nameLine = displayUser?.tag ?? `(API未取得) \`${target.userId}\``;
    const guildText = `${interaction.guild.name} / \`${guildId}\``;

    const embed = new EmbedBuilder()
      .setTitle("🔎 blacklist_show")
      .setColor(0xed4245)
      .addFields(
        { name: "ユーザーID", value: entry.user_id, inline: true },
        { name: "名前", value: nameLine, inline: true },
        { name: "施行日時", value: formatDateTime(entry.added_at), inline: true },
        { name: "どこのサーバー", value: guildText, inline: false },
        { name: "理由", value: entry.reason || "(理由なし)", inline: false },
        { name: "残り期限", value: formatRemaining(entry.expires_at), inline: true },
        { name: "設定期限", value: formatDateTime(entry.expires_at), inline: true },
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  if (sub === "config") {
    const enabled = interaction.options.getBoolean("enabled", true);
    const appealUrl = interaction.options.getString("appeal_url", false)?.trim() ?? "";
    const checked = validateAppealUrl(appealUrl);
    if (!checked.ok) {
      return interaction.editReply({ content: checked.error });
    }
    const setting = await GuildSettingDB.upsert(guildId, {
      blacklist_status_enabled: enabled,
      blacklist_appeal_url: checked.value,
    });
    return interaction.editReply({
      content: [
        `✅ /my-status 照会: ${setting.blacklist_status_enabled ? "有効" : "無効"}`,
        `異議申し立てURL: ${setting.blacklist_appeal_url || "未設定"}`,
      ].join("\n"),
    });
  }

  return interaction.editReply({ content: "❌ 不明なサブコマンドです。" });
}
