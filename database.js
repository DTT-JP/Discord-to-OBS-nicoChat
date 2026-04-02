import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSONFilePreset } from "lowdb/node";
import { hashToken, hashAuthCode, secureEqualHex } from "./utils/crypto.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = join(__dirname, "db.json");

/** @typedef {{ type: "role"|"user", id: string, guild_id: string }} Principal */
/** @typedef {{ type: "role"|"user", id: string, guild_id: string }} SetupPrincipal */
/** @typedef {{ guild_id: string, channel_id: string, added_by: string, added_at: number }} DenyChannel */
/** @typedef {{ guild_id: string, blacklist_status_enabled: boolean, blacklist_appeal_url: string }} GuildSetting */

/**
 * @typedef {Object} PendingAuth
 * @property {string} token
 * @property {string} token_hash
 * @property {string} socket_id
 * @property {string} user_id
 * @property {string} channel_id
 * @property {string} code_hash
 * @property {number} expires_at
 * @property {number} max_comments
 */

/**
 * @typedef {Object} ActiveSession
 * @property {string} token
 * @property {string} token_hash
 * @property {string} socket_id
 * @property {string} user_id
 * @property {string} channel_id
 * @property {string} aes_key
 * @property {number} created_at
 * @property {number} max_comments
 */

/**
 * @typedef {Object} GlobalBlacklistEntry
 * @property {string} user_id   - ブラックリスト対象のDiscordユーザーID
 * @property {string} added_by  - 追加したユーザーのID
 * @property {number} added_at  - 追加日時（Unix ms）
 * @property {string} reason    - 追加理由
 * @property {number|null} expires_at - 期限（Unix ms）null は無期限
 * @property {string} added_in_guild_id - 施行サーバー
 */

/**
 * @typedef {Object} LocalBlacklistEntry
 * @property {string} user_id   - ブラックリスト対象のDiscordユーザーID
 * @property {string} guild_id  - 対象のサーバーID
 * @property {string} added_by  - 追加したユーザーのID
 * @property {number} added_at  - 追加日時（Unix ms）
 * @property {string} reason    - 追加理由
 * @property {number|null} expires_at - 期限（Unix ms）null は無期限
 */

/**
 * @typedef {Object} DbSchema
 * @property {PendingAuth[]}          pending_auths
 * @property {ActiveSession[]}        active_sessions
 * @property {Principal[]}            allowed_principals
 * @property {SetupPrincipal[]}       setup_principals
 * @property {DenyChannel[]}          deny_channels
 * @property {GuildSetting[]}         guild_settings
 * @property {GlobalBlacklistEntry[]} global_blacklist
 * @property {LocalBlacklistEntry[]}  local_blacklist
 */

/** @type {DbSchema} */
const DEFAULT_DATA = {
  pending_auths:      [],
  active_sessions:    [],
  allowed_principals: [],
  setup_principals:   [],
  deny_channels:      [],
  guild_settings:     [],
  global_blacklist:   [],
  local_blacklist:    [],
};

const db = await JSONFilePreset(DB_PATH, DEFAULT_DATA);

// ── マイグレーション ────────────────────────────
// 旧 blacklist キーを global_blacklist へ移行
if (db.data.blacklist && !db.data.global_blacklist?.length) {
  db.data.global_blacklist = db.data.blacklist.map((e) => ({
    user_id:  e.user_id,
    added_by: e.added_by,
    added_at: e.added_at,
  }));
  delete db.data.blacklist;
  await db.write();
} else if (!db.data.global_blacklist) {
  db.data.global_blacklist = [];
  await db.write();
}

if (!db.data.local_blacklist) {
  db.data.local_blacklist = [];
  await db.write();
}
if (!db.data.setup_principals) {
  db.data.setup_principals = [];
  await db.write();
}
if (!db.data.deny_channels) {
  db.data.deny_channels = [];
  await db.write();
}
if (!db.data.guild_settings) {
  db.data.guild_settings = [];
  await db.write();
}

// ─────────────────────────────────────────────
// PendingAuth CRUD
// ─────────────────────────────────────────────

export const PendingAuthDB = {
  add(record) {
    record.token_hash = hashToken(record.token);
    record.code_hash  = record.code ? hashAuthCode(record.code, record.user_id) : "";
    record.token      = "";
    record.code       = "";
    db.data.pending_auths.push(record);
    return db.write();
  },
  findByToken(token) {
    const tokenHash = hashToken(token);
    return db.data.pending_auths.find((r) =>
      secureEqualHex(r.token_hash || hashToken(r.token || ""), tokenHash),
    );
  },
  findBySocketId(socketId) {
    return db.data.pending_auths.find((r) => r.socket_id === socketId);
  },
  findByUserId(userId) {
    return db.data.pending_auths.find((r) => r.user_id === userId);
  },
  findByCodeAndUser(code, userId) {
    const codeHash = hashAuthCode(code, userId);
    return db.data.pending_auths.find((r) => {
      if (r.user_id !== userId) return false;
      const recordHash = r.code_hash || (r.code ? hashAuthCode(r.code, r.user_id) : "");
      return secureEqualHex(recordHash, codeHash);
    });
  },
  removeByToken(token) {
    const tokenHash = hashToken(token);
    db.data.pending_auths = db.data.pending_auths.filter(
      (r) => !secureEqualHex(r.token_hash || hashToken(r.token || ""), tokenHash),
    );
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
    const tokenHash = hashToken(token);
    const record = db.data.pending_auths.find((r) =>
      secureEqualHex(r.token_hash || hashToken(r.token || ""), tokenHash),
    );
    if (!record) return Promise.resolve();
    record.socket_id = socketId;
    record.code_hash = hashAuthCode(code, record.user_id);
    record.code      = "";
    return db.write();
  },
};

// ─────────────────────────────────────────────
// ActiveSession CRUD
// ─────────────────────────────────────────────

export const ActiveSessionDB = {
  add(record) {
    record.token_hash = hashToken(record.token);
    record.token      = "";
    db.data.active_sessions.push(record);
    return db.write();
  },
  findByToken(token) {
    const tokenHash = hashToken(token);
    return db.data.active_sessions.find((r) =>
      secureEqualHex(r.token_hash || hashToken(r.token || ""), tokenHash),
    );
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

export const SetupPrincipalDB = {
  add(type, id, guildId) {
    const exists = db.data.setup_principals.some(
      (p) => p.type === type && p.id === id && p.guild_id === guildId,
    );
    if (exists) return Promise.resolve();
    db.data.setup_principals.push({ type, id, guild_id: guildId });
    return db.write();
  },
  remove(type, id, guildId) {
    db.data.setup_principals = db.data.setup_principals.filter(
      (p) => !(p.type === type && p.id === id && p.guild_id === guildId),
    );
    return db.write();
  },
  findByGuild(guildId) {
    return db.data.setup_principals.filter((p) => p.guild_id === guildId);
  },
  isAllowed(member) {
    const guildId = member.guild.id;
    const principals = db.data.setup_principals.filter((p) => p.guild_id === guildId);
    for (const p of principals) {
      if (p.type === "user" && p.id === member.id) return true;
      if (p.type === "role" && member.roles.cache.has(p.id)) return true;
    }
    return false;
  },
};

export const DenyChannelDB = {
  add(guildId, channelId, addedBy) {
    const exists = db.data.deny_channels.some(
      (e) => e.guild_id === guildId && e.channel_id === channelId,
    );
    if (exists) return Promise.resolve(false);
    db.data.deny_channels.push({
      guild_id: guildId,
      channel_id: channelId,
      added_by: addedBy,
      added_at: Date.now(),
    });
    return db.write().then(() => true);
  },
  remove(guildId, channelId) {
    const before = db.data.deny_channels.length;
    db.data.deny_channels = db.data.deny_channels.filter(
      (e) => !(e.guild_id === guildId && e.channel_id === channelId),
    );
    if (db.data.deny_channels.length === before) return Promise.resolve(false);
    return db.write().then(() => true);
  },
  has(guildId, channelId) {
    return db.data.deny_channels.some(
      (e) => e.guild_id === guildId && e.channel_id === channelId,
    );
  },
  findByGuild(guildId) {
    return db.data.deny_channels.filter((e) => e.guild_id === guildId);
  },
};

export const GuildSettingDB = {
  find(guildId) {
    return db.data.guild_settings.find((s) => s.guild_id === guildId)
      ?? { guild_id: guildId, blacklist_status_enabled: false, blacklist_appeal_url: "" };
  },
  async upsert(guildId, patch) {
    const existing = db.data.guild_settings.find((s) => s.guild_id === guildId);
    if (existing) {
      Object.assign(existing, patch);
    } else {
      db.data.guild_settings.push({
        guild_id: guildId,
        blacklist_status_enabled: false,
        blacklist_appeal_url: "",
        ...patch,
      });
    }
    await db.write();
    return this.find(guildId);
  },
};

// ─────────────────────────────────────────────
// GlobalBlacklist CRUD（全サーバー共通）
// ─────────────────────────────────────────────

export const GlobalBlacklistDB = {
  /**
   * ユーザーをグローバルブラックリストに追加
   * @param {string} userId
   * @param {string} addedBy
   * @returns {Promise<boolean>} 追加できたら true
   */
  add(userId, addedBy, reason = "", expiresAt = null, addedInGuildId = "") {
    const exists = db.data.global_blacklist.some((e) => e.user_id === userId);
    if (exists) return Promise.resolve(false);
    db.data.global_blacklist.push({
      user_id: userId,
      added_by: addedBy,
      added_at: Date.now(),
      reason,
      expires_at: expiresAt,
      added_in_guild_id: addedInGuildId,
    });
    return db.write().then(() => true);
  },

  /**
   * @param {string} userId
   * @returns {Promise<boolean>} 削除できたら true
   */
  remove(userId) {
    const before = db.data.global_blacklist.length;
    db.data.global_blacklist = db.data.global_blacklist.filter((e) => e.user_id !== userId);
    if (db.data.global_blacklist.length === before) return Promise.resolve(false);
    return db.write().then(() => true);
  },

  /**
   * @param {string} userId
   * @returns {boolean}
   */
  has(userId) {
    const now = Date.now();
    return db.data.global_blacklist.some((e) => (
      e.user_id === userId && (e.expires_at == null || e.expires_at > now)
    ));
  },

  /** @returns {GlobalBlacklistEntry[]} */
  findAll() {
    const now = Date.now();
    return db.data.global_blacklist.filter((e) => e.expires_at == null || e.expires_at > now);
  },
  find(userId) {
    const now = Date.now();
    return db.data.global_blacklist.find((e) => (
      e.user_id === userId && (e.expires_at == null || e.expires_at > now)
    ));
  },
};

// ─────────────────────────────────────────────
// LocalBlacklist CRUD（サーバーごと）
// ─────────────────────────────────────────────

export const LocalBlacklistDB = {
  /**
   * ユーザーをサーバーブラックリストに追加
   * @param {string} userId
   * @param {string} guildId
   * @param {string} addedBy
   * @returns {Promise<boolean>}
   */
  add(userId, guildId, addedBy, reason = "", expiresAt = null) {
    const exists = db.data.local_blacklist.some(
      (e) => e.user_id === userId && e.guild_id === guildId,
    );
    if (exists) return Promise.resolve(false);
    db.data.local_blacklist.push({
      user_id: userId,
      guild_id: guildId,
      added_by: addedBy,
      added_at: Date.now(),
      reason,
      expires_at: expiresAt,
    });
    return db.write().then(() => true);
  },

  /**
   * @param {string} userId
   * @param {string} guildId
   * @returns {Promise<boolean>}
   */
  remove(userId, guildId) {
    const before = db.data.local_blacklist.length;
    db.data.local_blacklist = db.data.local_blacklist.filter(
      (e) => !(e.user_id === userId && e.guild_id === guildId),
    );
    if (db.data.local_blacklist.length === before) return Promise.resolve(false);
    return db.write().then(() => true);
  },

  /**
   * 指定ユーザーが指定サーバーでブラックリストに登録されているか
   * @param {string} userId
   * @param {string} guildId
   * @returns {boolean}
   */
  has(userId, guildId) {
    const now = Date.now();
    return db.data.local_blacklist.some((e) => (
      e.user_id === userId && e.guild_id === guildId && (e.expires_at == null || e.expires_at > now)
    ));
  },

  /**
   * サーバー内の全エントリーを取得
   * @param {string} guildId
   * @returns {LocalBlacklistEntry[]}
   */
  findByGuild(guildId) {
    const now = Date.now();
    return db.data.local_blacklist.filter((e) => (
      e.guild_id === guildId && (e.expires_at == null || e.expires_at > now)
    ));
  },
  find(userId, guildId) {
    const now = Date.now();
    return db.data.local_blacklist.find((e) => (
      e.user_id === userId && e.guild_id === guildId && (e.expires_at == null || e.expires_at > now)
    ));
  },
};

// ─────────────────────────────────────────────
// 後方互換: 旧 BlacklistDB → GlobalBlacklistDB へのエイリアス
// interactionCreate.js など既存コードが BlacklistDB を参照している場合に備える
// ─────────────────────────────────────────────
export const BlacklistDB = GlobalBlacklistDB;
