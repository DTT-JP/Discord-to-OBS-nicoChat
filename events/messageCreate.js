import { Events } from "discord.js";
import {
  ActiveSessionDB,
  GlobalBlacklistDB,
  LocalBlacklistDB,
  GlobalGuildBlacklistDB,
} from "../database.js";
import { parseMessage } from "../discord/parser.js";
import { isBotOwnerUserId } from "../utils/botOwner.js";
import { AllowedPrincipalDB, SetupPrincipalDB } from "../database.js";

export const name  = Events.MessageCreate;
export const once  = false;

/** @type {((channelId: string, payload: object) => void) | null} */
let broadcastFn = null;

const WATCH_CACHE_TTL_MS = 1500;
/** @type {Set<string>} */
let watchChannelIdSet = new Set();
let watchCacheUntil = 0;

function refreshWatchChannelCacheIfNeeded() {
  const now = Date.now();
  if (now < watchCacheUntil) return;
  const ids = ActiveSessionDB.findDistinctConnectedChannelIds();
  watchChannelIdSet = new Set(ids);
  watchCacheUntil = now + WATCH_CACHE_TTL_MS;
}

export function setBroadcastFn(fn) {
  broadcastFn = fn;
}

// ─────────────────────────────────────────────
// 管理者判定
// ─────────────────────────────────────────────

/**
 * メッセージ送信者が管理者コメント扱いになるか判定する。
 * BOT_OWNER_ID に含まれるか、setup権限（サーバーオーナー・管理者・setup許可）を持つ場合にtrue。
 * @param {import("discord.js").Message} message
 * @returns {boolean}
 */
function isAdminMessage(message) {
  // BOT開発者
  if (isBotOwnerUserId(message.author.id)) return true;

  const member = message.member;
  if (!member || !message.guild) return false;

  // サーバーオーナー
  if (message.author.id === message.guild.ownerId) return true;

  // Administratorパーミッション
  if (member.permissions?.has("Administrator")) return true;

  // setup権限を持つユーザー・ロール
  if (SetupPrincipalDB.isAllowed(member)) return true;

  return false;
}

// ─────────────────────────────────────────────
// セッション主メンション検出
// ─────────────────────────────────────────────

/**
 * メッセージが当該チャンネルのセッション主をメンションしているか検出する。
 * @param {import("discord.js").Message} message
 * @param {import("../database.js").ActiveSession[]} sessions
 * @returns {boolean}
 */
function detectsMentionSessionOwner(message, sessions) {
  if (!message.mentions || message.mentions.users.size === 0) return false;
  for (const session of sessions) {
    if (message.mentions.users.has(session.user_id)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────
// ロール色マップ収集
// ─────────────────────────────────────────────

/**
 * メッセージ内のメンションユーザーのロール色を収集する。
 * ロール色が設定されていないユーザーはnullになる。
 * @param {import("discord.js").Message} message
 * @returns {Map<string, string|null>}
 */
function collectMentionColorMap(message) {
  const map = new Map();
  if (!message.guild || !message.mentions) return map;

  for (const [userId, user] of message.mentions.users) {
    // キャッシュからメンバー取得を試みる
    const member = message.guild.members.cache.get(userId);
    if (!member) {
      map.set(userId, null);
      continue;
    }

    // 最高ロールの色を取得（色が設定されていない場合はnull）
    const highestColoredRole = member.roles.cache
      .filter((r) => r.color !== 0 && r.id !== message.guild.id)
      .sort((a, b) => b.position - a.position)
      .first();

    // discord.jsのロール色は数値 → hex文字列に変換
    if (highestColoredRole) {
      const hex = "#" + highestColoredRole.color.toString(16).padStart(6, "0");
      map.set(userId, hex);
    } else {
      map.set(userId, null);
    }
  }

  return map;
}

// ─────────────────────────────────────────────
// メインイベントハンドラ
// ─────────────────────────────────────────────

/**
 * @param {import("discord.js").Message} message
 */
export async function execute(message) {
  if (!broadcastFn) return;
  if (message.author.bot) return;

  refreshWatchChannelCacheIfNeeded();
  if (!watchChannelIdSet.has(message.channelId)) return;

  // グローバルブラックリストチェック
  if (GlobalBlacklistDB.has(message.author.id)) return;

  // グローバルギルドブラックリストチェック
  const guildId = message.guildId;
  if (guildId && GlobalGuildBlacklistDB.hasGuild(guildId)) return;

  // ローカルブラックリストチェック
  if (guildId && LocalBlacklistDB.has(message.author.id, guildId)) return;

  // 当該チャンネルのセッション一覧を取得（管理者判定・メンション検出に使用）
  const sessions = ActiveSessionDB.findByChannelId(message.channelId);

  // 管理者判定
  const isAdmin = isAdminMessage(message);

  // セッション主メンション検出
  const mentionsSessionOwner = detectsMentionSessionOwner(message, sessions);

  // メンションのロール色収集（メンションが存在する場合のみ）
  const mentionColorMap = (message.mentions && message.mentions.users.size > 0)
    ? collectMentionColorMap(message)
    : new Map();

  // パーサー呼び出し
  const payload = parseMessage(message, watchChannelIdSet, {
    isAdmin,
    mentionsSessionOwner,
    mentionColorMap,
  });
  if (!payload) return;

  broadcastFn(message.channelId, payload);
}