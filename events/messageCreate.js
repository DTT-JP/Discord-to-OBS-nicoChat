import { Events } from "discord.js";
import { ActiveSessionDB, GlobalBlacklistDB, LocalBlacklistDB, GlobalGuildBlacklistDB } from "../database.js";
import { parseMessage } from "../discord/parser.js";

export const name  = Events.MessageCreate;
export const once  = false;

// socket/manager.js から注入されるブロードキャスト関数
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

/**
 * Socket Manager から呼び出し、ブロードキャスト関数を登録する
 * @param {(channelId: string, payload: object) => void} fn
 */
export function setBroadcastFn(fn) {
  broadcastFn = fn;
}

/**
 * @param {import("discord.js").Message} message
 */
export async function execute(message) {
  if (!broadcastFn) return;

  if (message.author.bot) return;

  // ── 先に「監視対象か」を判定（ここで DB を叩く回数を削減） ──
  refreshWatchChannelCacheIfNeeded();
  if (!watchChannelIdSet.has(message.channelId)) return;

  // ── グローバルブラックリストチェック ──────────
  // 全サーバー共通でOBSへの表示を遮断する
  if (GlobalBlacklistDB.has(message.author.id)) return;

  // ── グローバルギルドブラックリストチェック ──────
  // ブラックリスト対象ギルドではOBSへの表示を遮断する
  const guildId = message.guildId;
  if (guildId && GlobalGuildBlacklistDB.hasGuild(guildId)) return;

  // ── ローカルブラックリストチェック ────────────
  // そのサーバー内でブロックされているユーザーはOBSに流さない
  if (guildId && LocalBlacklistDB.has(message.author.id, guildId)) return;

  // パーサーに渡す（フィルタリングはparser内部で行う）
  const payload = parseMessage(message, watchChannelIdSet);
  if (!payload) return;

  // 該当チャンネルを監視しているセッションへブロードキャスト
  broadcastFn(message.channelId, payload);
}
