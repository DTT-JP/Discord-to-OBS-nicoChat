import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSONFilePreset } from "lowdb/node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = join(__dirname, "db.json");

/** @typedef {{ type: "role"|"user", id: string, guild_id: string }} Principal */

/**
 * @typedef {Object} PendingAuth
 * @property {string} token
 * @property {string} socket_id
 * @property {string} user_id
 * @property {string} channel_id
 * @property {string} code
 * @property {number} expires_at
 * @property {number} max_comments
 */

/**
 * @typedef {Object} ActiveSession
 * @property {string} token
 * @property {string} socket_id
 * @property {string} user_id
 * @property {string} channel_id
 * @property {string} aes_key
 * @property {number} created_at
 * @property {number} max_comments
 */

/**
 * @typedef {Object} BlacklistEntry
 * @property {string} user_id   - ブラックリスト対象のDiscordユーザーID
 * @property {string} added_by  - 追加したユーザーのID
 * @property {number} added_at  - 追加日時（Unix ms）
 */

/**
 * @typedef {Object} DbSchema
 * @property {PendingAuth[]}    pending_auths
 * @property {ActiveSession[]}  active_sessions
 * @property {Principal[]}      allowed_principals
 * @property {BlacklistEntry[]} blacklist
 */

/** @type {DbSchema} */
const DEFAULT_DATA = {
  pending_auths:      [],
  active_sessions:    [],
  allowed_principals: [],
  blacklist:          [],
};

const db = await JSONFilePreset(DB_PATH, DEFAULT_DATA);

// マイグレーション: 既存DBに blacklist がない場合追加
if (!db.data.blacklist) {
  db.data.blacklist = [];
  await db.write();
}

// ─────────────────────────────────────────────
// PendingAuth CRUD
// ─────────────────────────────────────────────

export const PendingAuthDB = {
  add(record) {
    db.data.pending_auths.push(record);
    return db.write();
  },
  findByToken(token) {
    return db.data.pending_auths.find((r) => r.token === token);
  },
  findBySocketId(socketId) {
    return db.data.pending_auths.find((r) => r.socket_id === socketId);
  },
  findByUserId(userId) {
    return db.data.pending_auths.find((r) => r.user_id === userId);
  },
  findByCodeAndUser(code, userId) {
    return db.data.pending_auths.find(
      (r) => r.code === code && r.user_id === userId,
    );
  },
  removeByToken(token) {
    db.data.pending_auths = db.data.pending_auths.filter((r) => r.token !== token);
    return db.write();
  },
  removeBySocketId(socketId) {
    db.data.pending_auths = db.data.pending_auths.filter((r) => r.socket_id !== socketId);
    return db.write();
  },
  removeByUserId(userId) {
    db.data.pending_auths = db.data.pending_auths.filter((r) => r.user_id !== userId);
    return db.write();
  },
  removeExpired() {
    const now = Date.now();
    db.data.pending_auths = db.data.pending_auths.filter((r) => r.expires_at > now);
    return db.write();
  },
  updateSocketAndCode(token, socketId, code) {
    const record = db.data.pending_auths.find((r) => r.token === token);
    if (!record) return Promise.resolve();
    record.socket_id = socketId;
    record.code      = code;
    return db.write();
  },
};

// ─────────────────────────────────────────────
// ActiveSession CRUD
// ─────────────────────────────────────────────

export const ActiveSessionDB = {
  add(record) {
    db.data.active_sessions.push(record);
    return db.write();
  },
  findByToken(token) {
    return db.data.active_sessions.find((r) => r.token === token);
  },
  findBySocketId(socketId) {
    return db.data.active_sessions.find((r) => r.socket_id === socketId);
  },
  findByUserId(userId) {
    return db.data.active_sessions.find((r) => r.user_id === userId);
  },
  findByChannelId(channelId) {
    return db.data.active_sessions.filter((r) => r.channel_id === channelId);
  },
  findAll() {
    return [...db.data.active_sessions];
  },
  count() {
    return db.data.active_sessions.length;
  },
  removeBySocketId(socketId) {
    db.data.active_sessions = db.data.active_sessions.filter((r) => r.socket_id !== socketId);
    return db.write();
  },
  removeByUserId(userId) {
    db.data.active_sessions = db.data.active_sessions.filter((r) => r.user_id !== userId);
    return db.write();
  },
  removeAll() {
    db.data.active_sessions = [];
    return db.write();
  },
  updateMaxComments(socketId, maxComments) {
    const record = db.data.active_sessions.find((r) => r.socket_id === socketId);
    if (!record) return Promise.resolve();
    record.max_comments = maxComments;
    return db.write();
  },
};

// ─────────────────────────────────────────────
// AllowedPrincipal CRUD
// ─────────────────────────────────────────────

export const AllowedPrincipalDB = {
  add(type, id, guildId) {
    const exists = db.data.allowed_principals.some(
      (p) => p.type === type && p.id === id && p.guild_id === guildId,
    );
    if (exists) return Promise.resolve();
    db.data.allowed_principals.push({ type, id, guild_id: guildId });
    return db.write();
  },
  remove(type, id, guildId) {
    db.data.allowed_principals = db.data.allowed_principals.filter(
      (p) => !(p.type === type && p.id === id && p.guild_id === guildId),
    );
    return db.write();
  },
  findByGuild(guildId) {
    return db.data.allowed_principals.filter((p) => p.guild_id === guildId);
  },
  /**
   * GuildMember が /start 実行権限を持つか判定
   * @param {import("discord.js").GuildMember} member
   * @returns {boolean}
   */
  isAllowed(member) {
    const guildId    = member.guild.id;
    const principals = db.data.allowed_principals.filter((p) => p.guild_id === guildId);
    if (principals.length === 0) return false;
    for (const p of principals) {
      if (p.type === "user" && p.id === member.id)             return true;
      if (p.type === "role" && member.roles.cache.has(p.id))   return true;
    }
    return false;
  },
};

// ─────────────────────────────────────────────
// Blacklist CRUD（グローバル・全サーバー共通）
// ─────────────────────────────────────────────

export const BlacklistDB = {
  /**
   * ユーザーをブラックリストに追加
   * @param {string} userId    - 対象ユーザーID
   * @param {string} addedBy   - 操作したユーザーID
   */
  add(userId, addedBy) {
    const exists = db.data.blacklist.some((e) => e.user_id === userId);
    if (exists) return Promise.resolve(false);
    db.data.blacklist.push({ user_id: userId, added_by: addedBy, added_at: Date.now() });
    return db.write().then(() => true);
  },

  /**
   * ユーザーをブラックリストから削除
   * @param {string} userId
   */
  remove(userId) {
    const before = db.data.blacklist.length;
    db.data.blacklist = db.data.blacklist.filter((e) => e.user_id !== userId);
    if (db.data.blacklist.length === before) return Promise.resolve(false);
    return db.write().then(() => true);
  },

  /**
   * ユーザーがブラックリストに登録されているか確認
   * @param {string} userId
   * @returns {boolean}
   */
  has(userId) {
    return db.data.blacklist.some((e) => e.user_id === userId);
  },

  /**
   * 全件取得
   * @returns {BlacklistEntry[]}
   */
  findAll() {
    return [...db.data.blacklist];
  },
};