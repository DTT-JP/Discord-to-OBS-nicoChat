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
} from "../database.js";
import { isAdminOrOwner, formatDateTime, formatRemaining, truncateReason } from "./moderation.js";

export const PAGE_SIZE = 10;
const PREFIX = "listpg";

/** @typedef {import("discord.js").ButtonInteraction | import("discord.js").ChatInputCommandInteraction} ListInteraction */

export const ListScope = {
  CONFIG_SETUP_ROLE: "cfg_sr",
  CONFIG_SETUP_USER: "cfg_su",
  CONFIG_BL_CTRL_ROLE: "cfg_br",
  CONFIG_BL_CTRL_USER: "cfg_bu",
  SETUP_DENY: "su_dn",
  SETUP_START_ROLE: "su_rr",
  SETUP_START_USER: "su_ru",
  BLACKLIST_ENTRIES: "bl_li",
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
};

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
 * @param {string} guildId
 * @returns {string[]}
 */
export function getLinesForScope(scope, guildId) {
  switch (scope) {
    case ListScope.CONFIG_SETUP_ROLE:
      return SetupPrincipalDB.findByGuild(guildId)
        .filter((p) => p.type === "role")
        .map((p) => `<@&${p.id}>`);
    case ListScope.CONFIG_SETUP_USER:
      return SetupPrincipalDB.findByGuild(guildId)
        .filter((p) => p.type === "user")
        .map((p) => `<@${p.id}>`);
    case ListScope.CONFIG_BL_CTRL_ROLE:
      return BlacklistCtrlPrincipalDB.findByGuild(guildId)
        .filter((p) => p.type === "role")
        .map((p) => `<@&${p.id}>`);
    case ListScope.CONFIG_BL_CTRL_USER:
      return BlacklistCtrlPrincipalDB.findByGuild(guildId)
        .filter((p) => p.type === "user")
        .map((p) => `<@${p.id}>`);
    case ListScope.SETUP_DENY:
      return DenyChannelDB.findByGuild(guildId).map(
        (e) =>
          `<#${e.channel_id}> / 追加者: <@${e.added_by}> / ${formatDateTime(e.added_at)}`,
      );
    case ListScope.SETUP_START_ROLE:
      return AllowedPrincipalDB.findByGuild(guildId)
        .filter((p) => p.type === "role")
        .map((p) => `<@&${p.id}>`);
    case ListScope.SETUP_START_USER:
      return AllowedPrincipalDB.findByGuild(guildId)
        .filter((p) => p.type === "user")
        .map((p) => `<@${p.id}>`);
    case ListScope.BLACKLIST_ENTRIES:
      return LocalBlacklistDB.findByGuild(guildId).map(
        (e) =>
          `<@${e.user_id}> / 残り: ${formatRemaining(e.expires_at)} / 理由: ${truncateReason(e.reason)}`,
      );
    default:
      return [];
  }
}

/**
 * @param {string} scope
 * @param {string} guildId
 * @param {string} userId
 * @param {number} page
 */
export function buildPageCustomId(scope, guildId, userId, page) {
  return `${PREFIX}:${scope}:${guildId}:${userId}:${page}`;
}

/**
 * @param {string} customId
 */
export function parsePageCustomId(customId) {
  const parts = customId.split(":");
  if (parts[0] !== PREFIX || parts.length !== 5) return null;
  const [, scope, guildId, userId, pageStr] = parts;
  const page = parseInt(pageStr, 10);
  if (!Number.isFinite(page) || page < 1) return null;
  return { scope, guildId, userId, page };
}

/**
 * @param {import("discord.js").ButtonInteraction} interaction
 * @param {string} scope
 */
function canUseListScope(interaction, scope) {
  if (!interaction.guild || !interaction.member) return false;
  const admin = isAdminOrOwner(interaction);
  switch (scope) {
    case ListScope.CONFIG_SETUP_ROLE:
    case ListScope.CONFIG_SETUP_USER:
    case ListScope.CONFIG_BL_CTRL_ROLE:
    case ListScope.CONFIG_BL_CTRL_USER:
      return admin;
    case ListScope.SETUP_DENY:
    case ListScope.SETUP_START_ROLE:
    case ListScope.SETUP_START_USER:
      if (admin) return true;
      return SetupPrincipalDB.isAllowed(interaction.member);
    case ListScope.BLACKLIST_ENTRIES:
      if (admin) return true;
      return BlacklistCtrlPrincipalDB.isAllowed(interaction.member);
    default:
      return false;
  }
}

/**
 * @param {string} scope
 * @param {string} guildId
 * @param {number} page
 */
export function buildListEmbed(scope, guildId, page) {
  const rawLines = getLinesForScope(scope, guildId);
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
 * @param {string} guildId
 * @param {string} userId
 * @param {number} page
 * @param {number} totalPages
 */
export function buildListArrowRow(scope, guildId, userId, page, totalPages) {
  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildPageCustomId(scope, guildId, userId, prevPage))
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(buildPageCustomId(scope, guildId, userId, nextPage))
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
  );
}

/**
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @param {string} scope
 */
export async function replyPaginatedList(interaction, scope) {
  const guildId = interaction.guild.id;
  const page = interaction.options.getInteger("page", false) ?? 1;
  const { embed, page: p, totalPages } = buildListEmbed(scope, guildId, page);
  const row = buildListArrowRow(scope, guildId, interaction.user.id, p, totalPages);
  await interaction.editReply({ embeds: [embed], components: [row] });
}

/**
 * @param {import("discord.js").ButtonInteraction} interaction
 * @param {{ scope: string, guildId: string, userId: string, page: number }} parsed
 */
export async function handleListPageButton(interaction, parsed) {
  if (interaction.user.id !== parsed.userId) {
    return interaction.reply({
      content: "❌ このページ送りは一覧を表示した人だけが使えます。",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!interaction.guild || interaction.guild.id !== parsed.guildId) {
    return interaction.reply({
      content: "❌ サーバーが一致しません。",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!canUseListScope(interaction, parsed.scope)) {
    return interaction.reply({
      content: "❌ この一覧を表示する権限がありません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const { embed, page, totalPages } = buildListEmbed(parsed.scope, parsed.guildId, parsed.page);
  const row = buildListArrowRow(
    parsed.scope,
    parsed.guildId,
    parsed.userId,
    page,
    totalPages,
  );

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [embed], components: [row] });
}
