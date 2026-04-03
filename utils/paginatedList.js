import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import {
  SetupPrincipalDB,
  BlacklistCtrlPrincipalDB,
  DenyChannelDB,
  AllowedPrincipalDB,
  LocalBlacklistDB,
  GlobalBlacklistDB,
  GlobalGuildBlacklistDB,
} from "../database.js";
import { isAdminOrOwner, formatDateTime, formatRemaining, truncateReason } from "./moderation.js";

export const PAGE_SIZE = 10;
const PREFIX = "listpg";

export const ListScope = {
  CONFIG_SETUP_ROLE: "cfg_sr",
  CONFIG_SETUP_USER: "cfg_su",
  CONFIG_BL_CTRL_ROLE: "cfg_br",
  CONFIG_BL_CTRL_USER: "cfg_bu",
  SETUP_DENY: "su_dn",
  SETUP_START_ROLE: "su_rr",
  SETUP_START_USER: "su_ru",
  BLACKLIST_ENTRIES: "bl_li",
  GLOBAL_BL: "gbl",
  GLOBAL_GUILD_BL: "ggbl",
};

const TITLES = {
  [ListScope.CONFIG_SETUP_ROLE]: "📋 /config — /setup 許可ロール",
  [ListScope.CONFIG_SETUP_USER]: "📋 /config — /setup 許可ユーザー",
  [ListScope.CONFIG_BL_CTRL_ROLE]: "📋 /config — /blacklist 操作許可ロール",
  [ListScope.CONFIG_BL_CTRL_USER]: "📋 /config — /blacklist 操作許可ユーザー",
  [ListScope.SETUP_DENY]: "🚫 /setup — 拒否チャンネル",
  [ListScope.SETUP_START_ROLE]: "🎬 /setup — /start 許可ロール",
  [ListScope.SETUP_START_USER]: "🎬 /setup — /start 許可ユーザー",
  [ListScope.BLACKLIST_ENTRIES]: "🚫 /blacklist — サーバー登録一覧",
  [ListScope.GLOBAL_BL]: "🚫 /global_blacklist — 一覧",
  [ListScope.GLOBAL_GUILD_BL]: "🚫 /global_guild_blacklist — 一覧",
};

const COLORS = {
  [ListScope.CONFIG_SETUP_ROLE]: 0x5865f2,
  [ListScope.CONFIG_SETUP_USER]: 0x5865f2,
  [ListScope.CONFIG_BL_CTRL_ROLE]: 0x5865f2,
  [ListScope.CONFIG_BL_CTRL_USER]: 0x5865f2,
  [ListScope.SETUP_DENY]: 0xed4245,
  [ListScope.SETUP_START_ROLE]: 0x57f287,
  [ListScope.SETUP_START_USER]: 0x57f287,
  [ListScope.BLACKLIST_ENTRIES]: 0xed4245,
  [ListScope.GLOBAL_BL]: 0xed4245,
  [ListScope.GLOBAL_GUILD_BL]: 0xed4245,
};

const FOOTER_RE = /ページ (\d+)\/(\d+)/;

/**
 * @param {import("discord.js").Embed} [embed]
 */
function parsePageFromFooter(embed) {
  const t = embed?.footer?.text ?? "";
  const m = t.match(FOOTER_RE);
  if (!m) return { page: 1, totalPages: 1 };
  const page = parseInt(m[1], 10);
  const totalPages = parseInt(m[2], 10);
  return {
    page: Number.isFinite(page) ? page : 1,
    totalPages: Number.isFinite(totalPages) ? totalPages : 1,
  };
}

/**
 * @param {string[]} items
 * @param {number} page
 */
export function paginateSlice(items, page) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
  const p = Math.min(Math.max(1, page), totalPages);
  const start = (p - 1) * PAGE_SIZE;
  return { page: p, totalPages, slice: items.slice(start, start + PAGE_SIZE), total };
}

/**
 * @param {string} scope
 * @param {string} listKey guild id or `"global"`
 * @returns {string[]}
 */
export function getLinesForScope(scope, listKey) {
  switch (scope) {
    case ListScope.CONFIG_SETUP_ROLE:
      return SetupPrincipalDB.findByGuild(listKey)
        .filter((p) => p.type === "role")
        .map((p) => `<@&${p.id}>`);
    case ListScope.CONFIG_SETUP_USER:
      return SetupPrincipalDB.findByGuild(listKey)
        .filter((p) => p.type === "user")
        .map((p) => `<@${p.id}>`);
    case ListScope.CONFIG_BL_CTRL_ROLE:
      return BlacklistCtrlPrincipalDB.findByGuild(listKey)
        .filter((p) => p.type === "role")
        .map((p) => `<@&${p.id}>`);
    case ListScope.CONFIG_BL_CTRL_USER:
      return BlacklistCtrlPrincipalDB.findByGuild(listKey)
        .filter((p) => p.type === "user")
        .map((p) => `<@${p.id}>`);
    case ListScope.SETUP_DENY:
      return DenyChannelDB.findByGuild(listKey).map(
        (e) =>
          `<#${e.channel_id}> / 追加者: <@${e.added_by}> / ${formatDateTime(e.added_at)}`,
      );
    case ListScope.SETUP_START_ROLE:
      return AllowedPrincipalDB.findByGuild(listKey)
        .filter((p) => p.type === "role")
        .map((p) => `<@&${p.id}>`);
    case ListScope.SETUP_START_USER:
      return AllowedPrincipalDB.findByGuild(listKey)
        .filter((p) => p.type === "user")
        .map((p) => `<@${p.id}>`);
    case ListScope.BLACKLIST_ENTRIES:
      return LocalBlacklistDB.findByGuild(listKey).map(
        (e) =>
          `<@${e.user_id}> / 残り: ${formatRemaining(e.expires_at)} / 理由: ${truncateReason(e.reason)}`,
      );
    case ListScope.GLOBAL_BL:
      return GlobalBlacklistDB.findAll().map(
        (e) =>
          `<@${e.user_id}> / ID: \`${e.user_id}\` / 残り: ${formatRemaining(e.expires_at)} / 理由: ${truncateReason(e.reason)}`,
      );
    case ListScope.GLOBAL_GUILD_BL:
      return GlobalGuildBlacklistDB.findAll().map((e) => {
        const untilText = formatDateTime(e.expires_at);
        const pubReason = truncateReason(e.public_reason);
        const internal = truncateReason(e.internal_reason);
        return `ギルドID: \`${e.guild_id}\` / 残り: ${formatRemaining(e.expires_at)} / 公開理由: ${pubReason} / 内部理由: ${internal} / 解除日時: ${untilText}`;
      });
    default:
      return [];
  }
}

/**
 * prev / next で一意な custom_id にする（同一ページへの移動で重複しない）
 * @param {"prev"|"next"} direction
 */
export function buildNavCustomId(scope, listKey, userId, direction) {
  return `${PREFIX}:${scope}:${listKey}:${userId}:${direction}`;
}

/**
 * @param {string} customId
 */
export function parsePageCustomId(customId) {
  const parts = customId.split(":");
  if (parts[0] !== PREFIX || parts.length !== 5) return null;
  const [, scope, listKey, userId, direction] = parts;
  if (direction !== "prev" && direction !== "next") return null;
  return { scope, listKey, userId, direction };
}

/**
 * @param {import("discord.js").ButtonInteraction} interaction
 * @param {string} scope
 */
function canUseListScope(interaction, scope) {
  const admin = interaction.guild ? isAdminOrOwner(interaction) : false;
  switch (scope) {
    case ListScope.CONFIG_SETUP_ROLE:
    case ListScope.CONFIG_SETUP_USER:
    case ListScope.CONFIG_BL_CTRL_ROLE:
    case ListScope.CONFIG_BL_CTRL_USER:
      return !!(interaction.guild && admin);
    case ListScope.SETUP_DENY:
    case ListScope.SETUP_START_ROLE:
    case ListScope.SETUP_START_USER:
      if (!interaction.guild || !interaction.member) return false;
      if (admin) return true;
      return SetupPrincipalDB.isAllowed(interaction.member);
    case ListScope.BLACKLIST_ENTRIES:
      if (!interaction.guild || !interaction.member) return false;
      if (admin) return true;
      return BlacklistCtrlPrincipalDB.isAllowed(interaction.member);
    case ListScope.GLOBAL_BL: {
      const ownerId = process.env.BOT_OWNER_ID?.trim();
      return !!(ownerId && interaction.user.id === ownerId);
    }
    case ListScope.GLOBAL_GUILD_BL: {
      const ownerId = process.env.BOT_OWNER_ID?.trim();
      return !!(ownerId && interaction.user.id === ownerId);
    }
    default:
      return false;
  }
}

/**
 * listKey: guild id または global 一覧用 `"global"`
 * @param {string} scope
 * @param {string} listKey
 * @param {number} page
 */
export function buildListEmbed(scope, listKey, page) {
  const rawLines = getLinesForScope(scope, listKey);
  const { page: p, totalPages, slice, total } = paginateSlice(rawLines, page);
  const title = TITLES[scope] ?? "一覧";
  const color = COLORS[scope] ?? 0x5865f2;

  const body =
    slice.length > 0
      ? slice.map((line, i) => `${(p - 1) * PAGE_SIZE + i + 1}. ${line}`).join("\n")
      : "なし";

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(body.length > 4096 ? `${body.slice(0, 4080)}…` : body)
    .setFooter({ text: `ページ ${p}/${totalPages}（全 ${total} 件）` });

  return { embed, page: p, totalPages, total };
}

/**
 * @param {string} scope
 * @param {string} listKey
 * @param {string} userId
 * @param {number} page
 * @param {number} totalPages
 */
export function buildListArrowRow(scope, listKey, userId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildNavCustomId(scope, listKey, userId, "prev"))
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(buildNavCustomId(scope, listKey, userId, "next"))
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
  );
}

/**
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @param {string} scope
 * @param {string | null} [listKeyOverride] 省略時は interaction.guild.id（グローバル一覧は `"global"`）
 */
export async function replyPaginatedList(interaction, scope, listKeyOverride = null) {
  const listKey = listKeyOverride ?? interaction.guild?.id;
  if (!listKey) {
    await interaction.editReply({ content: "❌ この操作にはサーバー情報が必要です。" });
    return;
  }
  const page = interaction.options.getInteger("page", false) ?? 1;
  const { embed, page: p, totalPages } = buildListEmbed(scope, listKey, page);
  const row = buildListArrowRow(scope, listKey, interaction.user.id, p, totalPages);
  await interaction.editReply({ embeds: [embed], components: [row] });
}

/**
 * @param {import("discord.js").ButtonInteraction} interaction
 * @param {{ scope: string, listKey: string, userId: string, direction: "prev"|"next" }} parsed
 */
export async function handleListPageButton(interaction, parsed) {
  if (interaction.user.id !== parsed.userId) {
    return interaction.reply({
      content: "❌ このページ送りは一覧を表示した人だけが使えます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (parsed.listKey !== "global") {
    if (!interaction.guild || interaction.guild.id !== parsed.listKey) {
      return interaction.reply({
        content: "❌ サーバーが一致しません。",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (!canUseListScope(interaction, parsed.scope)) {
    return interaction.reply({
      content: "❌ この一覧を表示する権限がありません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const { page: curPage, totalPages } = parsePageFromFooter(interaction.message.embeds[0]);
  let newPage = curPage;
  if (parsed.direction === "prev") newPage = Math.max(1, curPage - 1);
  else newPage = Math.min(totalPages, curPage + 1);

  const { embed, page, totalPages: tp } = buildListEmbed(parsed.scope, parsed.listKey, newPage);
  const row = buildListArrowRow(parsed.scope, parsed.listKey, parsed.userId, page, tp);

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [embed], components: [row] });
}
