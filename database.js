import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSONFilePreset } from "lowdb/node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = join(__dirname, "db.json");

/** @typedef {{ type: "role"|"user", id: string, guild_id: string }} Principal */

/**
 * @typedef {Object} DbSchema
 * @property {PendingAuth[]}    pending_auths
 * @property {ActiveSession[]}  active_sessions
 * @property {Principal[]}      allowed_principals
 */

/**
 * @typedef {Object} PendingAuth
 * @property {string} token        - UUID v4
 * @property {string} socket_id    - Socket.io の socket.id
 * @property {string} user_id      - Discord ユーザーID
 * @property {string} channel_id   - 監視対象チャンネルID
 * @property {string} code         - 6桁認証コード
 * @property {number} expires_at   - Unix ms
 */

/**
 * @typedef {Object} ActiveSession
 * @property {string} token
 * @property {string} socket_id
 * @property {string} user_id
 * @property {string} channel_id
 * @property {string} aes_key      - 32バイト hex文字列
 * @property {number} created_at   - Unix ms
 */

/** @type {DbSchema} */
const DEFAULT_DATA = {
  pending_auths:      [],
  active_sessions:    [],
  allowed_principals: [],
};

// lowdb インスタンス（シングルトン）
const db = await JSONFilePreset(DB_PATH, DEFAULT_DATA);

// ─────────────────────────────────────────────
// PendingAuth CRUD
// ─────────────────────────────────────────────

export const PendingAuthDB = {
  /**
   * pending_auth を追加する
   * @param {PendingAuth} record
   */
  add(record) {
    db.data.pending_auths.push(record);
    return db.write();
  },

  /**
   * token で検索
   * @param {string} token
   * @returns {PendingAuth|undefined}
   */
  findByToken(token) {
    return db.data.pending_auths.find((r) => r.token === token);
  },

  /**
   * socket_id で検索
   * @param {string} socketId
   * @returns {PendingAuth|undefined}
   */
  findBySocketId(socketId) {
    return db.data.pending_auths.find((r) => r.socket_id === socketId);
  },

  /**
   * user_id で検索（最新1件）
   * @param {string} userId
   * @returns {PendingAuth|undefined}
   */
  findByUserId(userId) {
    return db.data.pending_auths.find((r) => r.user_id === userId);
  },

  /**
   * code と user_id で検索
   * @param {string} code
   * @param {string} userId
   * @returns {PendingAuth|undefined}
   */
  findByCodeAndUser(code, userId) {
    return db.data.pending_auths.find(
      (r) => r.code === code && r.user_id === userId,
    );
  },

  /**
   * token で削除
   * @param {string} token
   */
  removeByToken(token) {
    db.data.pending_auths = db.data.pending_auths.filter(
      (r) => r.token !== token,
    );
    return db.write();
  },

  /**
   * socket_id で削除
   * @param {string} socketId
   */
  removeBySocketId(socketId) {
    db.data.pending_auths = db.data.pending_auths.filter(
      (r) => r.socket_id !== socketId,
    );
    return db.write();
  },

  /**
   * user_id で削除（全件）
   * @param {string} userId
   */
  removeByUserId(userId) {
    db.data.pending_auths = db.data.pending_auths.filter(
      (r) => r.user_id !== userId,
    );
    return db.write();
  },

  /**
   * 期限切れレコードを一括削除
   */
  removeExpired() {
    const now = Date.now();
    db.data.pending_auths = db.data.pending_auths.filter(
      (r) => r.expires_at > now,
    );
    return db.write();
  },
  // database.js の PendingAuthDB に追記するメソッド

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
  /**
   * セッションを追加する
   * @param {ActiveSession} record
   */
  add(record) {
    db.data.active_sessions.push(record);
    return db.write();
  },

  /**
   * token で検索
   * @param {string} token
   * @returns {ActiveSession|undefined}
   */
  findByToken(token) {
    return db.data.active_sessions.find((r) => r.token === token);
  },

  /**
   * socket_id で検索
   * @param {string} socketId
   * @returns {ActiveSession|undefined}
   */
  findBySocketId(socketId) {
    return db.data.active_sessions.find((r) => r.socket_id === socketId);
  },

  /**
   * user_id で検索（最新1件）
   * @param {string} userId
   * @returns {ActiveSession|undefined}
   */
  findByUserId(userId) {
    return db.data.active_sessions.find((r) => r.user_id === userId);
  },

  /**
   * 監視チャンネルIDに対応するセッションを全件取得
   * @param {string} channelId
   * @returns {ActiveSession[]}
   */
  findByChannelId(channelId) {
    return db.data.active_sessions.filter((r) => r.channel_id === channelId);
  },

  /**
   * 全件取得
   * @returns {ActiveSession[]}
   */
  findAll() {
    return [...db.data.active_sessions];
  },

  /**
   * 件数を返す
   * @returns {number}
   */
  count() {
    return db.data.active_sessions.length;
  },

  /**
   * socket_id でセッションを削除
   * @param {string} socketId
   */
  removeBySocketId(socketId) {
    db.data.active_sessions = db.data.active_sessions.filter(
      (r) => r.socket_id !== socketId,
    );
    return db.write();
  },

  /**
   * user_id でセッションを削除（全件）
   * @param {string} userId
   */
  removeByUserId(userId) {
    db.data.active_sessions = db.data.active_sessions.filter(
      (r) => r.user_id !== userId,
    );
    return db.write();
  },

  /**
   * 全セッションを削除（プロセス終了時クリーンアップ用）
   */
  removeAll() {
    db.data.active_sessions = [];
    return db.write();
  },
};

// ─────────────────────────────────────────────
// AllowedPrincipal CRUD
// ─────────────────────────────────────────────

export const AllowedPrincipalDB = {
  /**
   * ロールまたはユーザーを許可リストに追加
   * @param {"role"|"user"} type
   * @param {string} id
   * @param {string} guildId
   */
  add(type, id, guildId) {
    const exists = db.data.allowed_principals.some(
      (p) => p.type === type && p.id === id && p.guild_id === guildId,
    );
    if (exists) return Promise.resolve();
    db.data.allowed_principals.push({ type, id, guild_id: guildId });
    return db.write();
  },

  /**
   * ロールまたはユーザーを許可リストから削除
   * @param {"role"|"user"} type
   * @param {string} id
   * @param {string} guildId
   */
  remove(type, id, guildId) {
    db.data.allowed_principals = db.data.allowed_principals.filter(
      (p) => !(p.type === type && p.id === id && p.guild_id === guildId),
    );
    return db.write();
  },

  /**
   * 指定ギルドの許可リストを全件取得
   * @param {string} guildId
   * @returns {Principal[]}
   */
  findByGuild(guildId) {
    return db.data.allowed_principals.filter((p) => p.guild_id === guildId);
  },

  /**
   * Discord の GuildMember が許可されているか検証
   * guild_id で必ずスコープを絞る
   * @param {import("discord.js").GuildMember} member
   * @returns {boolean}
   */
  isAllowed(member) {
    const guildId    = member.guild.id;
    const principals = db.data.allowed_principals.filter(
      (p) => p.guild_id === guildId,
    );

    // そのギルドの許可リストが空の場合は全員拒否
    if (principals.length === 0) return false;

    for (const p of principals) {
      if (p.type === "user" && p.id === member.id)                return true;
      if (p.type === "role" && member.roles.cache.has(p.id))      return true;
    }
    return false;
  },
};