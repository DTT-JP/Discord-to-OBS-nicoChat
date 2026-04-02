import { Events } from "discord.js";
import { ActiveSessionDB, GlobalBlacklistDB, LocalBlacklistDB } from "../database.js";
import { parseMessage } from "../discord/parser.js";

export const name  = Events.MessageCreate;
export const once  = false;

// socket/manager.js から注入されるブロードキャスト関数
/** @type {((channelId: string, payload: object) => void) | null} */
let broadcastFn = null;

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

  // ── グローバルブラックリストチェック ──────────
  // 全サーバー共通でOBSへの表示を遮断する
  if (GlobalBlacklistDB.has(message.author.id)) return;

  // ── ローカルブラックリストチェック ────────────
  // そのサーバー内でブロックされているユーザーはOBSに流さない
  const guildId = message.guildId;
  if (guildId && LocalBlacklistDB.has(message.author.id, guildId)) return;

  // 現在アクティブなセッションの監視チャンネルID一覧を取得
  const sessions        = ActiveSessionDB.findAll();
  const watchChannelIds = [...new Set(sessions.map((s) => s.channel_id))];

  if (watchChannelIds.length === 0) return;

  // パーサーに渡す（フィルタリングはparser内部で行う）
  const payload = parseMessage(message, watchChannelIds);
  if (!payload) return;

  // 該当チャンネルを監視しているセッションへブロードキャスト
  broadcastFn(message.channelId, payload);
}
