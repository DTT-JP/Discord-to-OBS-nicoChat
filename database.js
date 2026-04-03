import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { hashToken, hashAuthCode, secureEqualHex, encrypt, decrypt } from "./utils/crypto.js";
import { deriveGuildSettingsKeyHex } from "./utils/deriveGuildKey.js";

const __dirname   = dirname(fileURLToPath(import.meta.url));
const SQLITE_PATH = join(__dirname, "app.db");
const LEGACY_JSON = join(__dirname, "db.json");

/** @typedef {{ type: "role"|"user", id: string, guild_id: string }} Principal */
/** @typedef {{ type: "role"|"user", id: string, guild_id: string }} SetupPrincipal */
/** @typedef {{ guild_id: string, channel_id: string, added_by: string, added_at: number }} DenyChannel */
/** @typedef {{ guild_id: string, blacklist_status_enabled: boolean, blacklist_appeal_url: string }} GuildSettingPlain */

/**
 * @typedef {Object} PendingAuth
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
 * @property {string} token_hash
 * @property {string} socket_id
 * @property {string} user_id
 * @property {string} channel_id
 * @property {string} aes_key
 * @property {number} created_at
 * @property {number} max_comments
 * @property {string|null} [resume_token_hash]
 */

const db = new Database(SQLITE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = FULL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 8000");

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_auths (
      token_hash   TEXT PRIMARY KEY,
      socket_id    TEXT NOT NULL DEFAULT '',
      user_id      TEXT NOT NULL,
      channel_id   TEXT NOT NULL,
      code_hash    TEXT NOT NULL DEFAULT '',
      expires_at   INTEGER NOT NULL,
      max_comments INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS active_sessions (
      token_hash        TEXT PRIMARY KEY,
      socket_id         TEXT NOT NULL DEFAULT '',
      user_id           TEXT NOT NULL,
      channel_id        TEXT NOT NULL,
      aes_key           TEXT NOT NULL,
      created_at        INTEGER NOT NULL,
      max_comments      INTEGER NOT NULL,
      resume_token_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS allowed_principals (
      type     TEXT NOT NULL,
      id       TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      PRIMARY KEY (type, id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS setup_principals (
      type     TEXT NOT NULL,
      id       TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      PRIMARY KEY (type, id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS deny_channels (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      added_by   TEXT NOT NULL,
      added_at   INTEGER NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id             TEXT PRIMARY KEY,
      settings_ciphertext  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS global_blacklist (
      user_id            TEXT PRIMARY KEY,
      added_by           TEXT NOT NULL,
      added_at           INTEGER NOT NULL,
      reason             TEXT NOT NULL DEFAULT '',
      expires_at         INTEGER,
      added_in_guild_id  TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS local_blacklist (
      user_id    TEXT NOT NULL,
      guild_id   TEXT NOT NULL,
      added_by   TEXT NOT NULL,
      added_at   INTEGER NOT NULL,
      reason     TEXT NOT NULL DEFAULT '',
      expires_at INTEGER,
      PRIMARY KEY (user_id, guild_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pending_user    ON pending_auths(user_id);
    CREATE INDEX IF NOT EXISTS idx_pending_socket   ON pending_auths(socket_id);
    CREATE INDEX IF NOT EXISTS idx_active_user      ON active_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_active_channel   ON active_sessions(channel_id);
    CREATE INDEX IF NOT EXISTS idx_active_socket     ON active_sessions(socket_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_resume
      ON active_sessions(resume_token_hash)
      WHERE resume_token_hash IS NOT NULL AND resume_token_hash != '';
  `);
}

initSchema();

/**
 * lowdb の db.json を一度だけ SQLite へ取り込む（トランザクション）
 */
export function migrateLegacyJsonIfNeeded() {
  const nP = /** @type {{ c: number }} */ (db.prepare("SELECT COUNT(*) AS c FROM pending_auths").get()).c;
  const nA = /** @type {{ c: number }} */ (db.prepare("SELECT COUNT(*) AS c FROM active_sessions").get()).c;
  if (nP > 0 || nA > 0) return;
  if (!existsSync(LEGACY_JSON)) return;

  let raw;
  try {
    raw = JSON.parse(readFileSync(LEGACY_JSON, "utf8"));
  } catch {
    console.warn("[database] db.json の読み込みに失敗しました（移行スキップ）");
    return;
  }

  const txn = db.transaction(() => {
    for (const r of raw.pending_auths ?? []) {
      const th = r.token_hash || (r.token ? hashToken(r.token) : "");
      if (!th) continue;
      db.prepare(
        `INSERT OR IGNORE INTO pending_auths
         (token_hash, socket_id, user_id, channel_id, code_hash, expires_at, max_comments)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(
        th,
        r.socket_id ?? "",
        r.user_id,
        r.channel_id,
        r.code_hash || (r.code ? hashAuthCode(r.code, r.user_id) : ""),
        r.expires_at,
        r.max_comments ?? 30,
      );
    }

    for (const r of raw.active_sessions ?? []) {
      const th = r.token_hash || (r.token ? hashToken(r.token) : "");
      if (!th) continue;
      db.prepare(
        `INSERT OR IGNORE INTO active_sessions
         (token_hash, socket_id, user_id, channel_id, aes_key, created_at, max_comments, resume_token_hash)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        th,
        r.socket_id ?? "",
        r.user_id,
        r.channel_id,
        r.aes_key,
        r.created_at ?? Date.now(),
        r.max_comments ?? 30,
        r.resume_token_hash ?? null,
      );
    }

    for (const p of raw.allowed_principals ?? []) {
      db.prepare(
        `INSERT OR IGNORE INTO allowed_principals (type, id, guild_id) VALUES (?,?,?)`,
      ).run(p.type, p.id, p.guild_id);
    }

    for (const p of raw.setup_principals ?? []) {
      db.prepare(
        `INSERT OR IGNORE INTO setup_principals (type, id, guild_id) VALUES (?,?,?)`,
      ).run(p.type, p.id, p.guild_id);
    }

    for (const e of raw.deny_channels ?? []) {
      db.prepare(
        `INSERT OR IGNORE INTO deny_channels (guild_id, channel_id, added_by, added_at) VALUES (?,?,?,?)`,
      ).run(e.guild_id, e.channel_id, e.added_by, e.added_at);
    }

    for (const s of raw.guild_settings ?? []) {
      const gid = s.guild_id;
      const keyHex = deriveGuildSettingsKeyHex(gid);
      const payload = JSON.stringify({
        blacklist_status_enabled: !!s.blacklist_status_enabled,
        blacklist_appeal_url:     String(s.blacklist_appeal_url ?? ""),
      });
      const ct = encrypt(payload, keyHex);
      db.prepare(
        `INSERT OR IGNORE INTO guild_settings (guild_id, settings_ciphertext) VALUES (?,?)`,
      ).run(gid, ct);
    }

    for (const e of raw.global_blacklist ?? []) {
      db.prepare(
        `INSERT OR IGNORE INTO global_blacklist
         (user_id, added_by, added_at, reason, expires_at, added_in_guild_id)
         VALUES (?,?,?,?,?,?)`,
      ).run(
        e.user_id,
        e.added_by,
        e.added_at,
        e.reason ?? "",
        e.expires_at ?? null,
        e.added_in_guild_id ?? "",
      );
    }

    for (const e of raw.local_blacklist ?? []) {
      db.prepare(
        `INSERT OR IGNORE INTO local_blacklist
         (user_id, guild_id, added_by, added_at, reason, expires_at)
         VALUES (?,?,?,?,?,?)`,
      ).run(
        e.user_id,
        e.guild_id,
        e.added_by,
        e.added_at,
        e.reason ?? "",
        e.expires_at ?? null,
      );
    }
  });

  txn();
  console.log("[database] db.json から SQLite への移行を完了しました");
}

// ─────────────────────────────────────────────
// PendingAuth CRUD
// ─────────────────────────────────────────────

export const PendingAuthDB = {
  /**
   * @param {Omit<PendingAuth, "token_hash"> & { token: string, code?: string }} record
   */
  add(record) {
    const tokenHash = hashToken(record.token);
    const codeHash  = record.code ? hashAuthCode(record.code, record.user_id) : "";
    const run = db.transaction(() => {
      db.prepare(
        `INSERT INTO pending_auths
         (token_hash, socket_id, user_id, channel_id, code_hash, expires_at, max_comments)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(
        tokenHash,
        record.socket_id ?? "",
        record.user_id,
        record.channel_id,
        codeHash,
        record.expires_at,
        record.max_comments,
      );
    });
    run();
    return Promise.resolve();
  },
  findByToken(token) {
    const tokenHash = hashToken(token);
    const row = db.prepare("SELECT * FROM pending_auths WHERE token_hash = ?").get(tokenHash);
    return row ?? undefined;
  },
  findBySocketId(socketId) {
    return db.prepare("SELECT * FROM pending_auths WHERE socket_id = ?").get(socketId) ?? undefined;
  },
  findByUserId(userId) {
    return db.prepare("SELECT * FROM pending_auths WHERE user_id = ?").get(userId) ?? undefined;
  },
  findByCodeAndUser(code, userId) {
    const codeHash = hashAuthCode(code, userId);
    const rows     = db.prepare("SELECT * FROM pending_auths WHERE user_id = ?").all(userId);
    return rows.find((r) => secureEqualHex(r.code_hash || "", codeHash));
  },
  removeByToken(token) {
    const tokenHash = hashToken(token);
    db.prepare("DELETE FROM pending_auths WHERE token_hash = ?").run(tokenHash);
    return Promise.resolve();
  },
  removeBySocketId(socketId) {
    db.prepare("DELETE FROM pending_auths WHERE socket_id = ?").run(socketId);
    return Promise.resolve();
  },
  removeByUserId(userId) {
    db.prepare("DELETE FROM pending_auths WHERE user_id = ?").run(userId);
    return Promise.resolve();
  },
  removeExpired() {
    const now = Date.now();
    db.prepare("DELETE FROM pending_auths WHERE expires_at <= ?").run(now);
    return Promise.resolve();
  },
  updateSocketAndCode(token, socketId, code) {
    const tokenHash = hashToken(token);
    const run = db.transaction(() => {
      const row = db.prepare("SELECT user_id FROM pending_auths WHERE token_hash = ?").get(tokenHash);
      if (!row) return;
      const codeHash = hashAuthCode(code, row.user_id);
      db.prepare(
        `UPDATE pending_auths SET socket_id = ?, code_hash = ? WHERE token_hash = ?`,
      ).run(socketId, codeHash, tokenHash);
    });
    run();
    return Promise.resolve();
  },
};

// ─────────────────────────────────────────────
// ActiveSession CRUD
// ─────────────────────────────────────────────

export const ActiveSessionDB = {
  /**
   * @param {Omit<ActiveSession, "token_hash"> & { token?: string, token_hash?: string, resume_token_hash?: string }} record
   */
  add(record) {
    const tokenHash = record.token_hash || hashToken(record.token || "");
    const run = db.transaction(() => {
      db.prepare(
        `INSERT INTO active_sessions
         (token_hash, socket_id, user_id, channel_id, aes_key, created_at, max_comments, resume_token_hash)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        tokenHash,
        record.socket_id ?? "",
        record.user_id,
        record.channel_id,
        record.aes_key,
        record.created_at,
        record.max_comments,
        record.resume_token_hash ?? null,
      );
    });
    run();
    return Promise.resolve();
  },
  findByToken(token) {
    const tokenHash = hashToken(token);
    return db.prepare("SELECT * FROM active_sessions WHERE token_hash = ?").get(tokenHash) ?? undefined;
  },
  findBySocketId(socketId) {
    if (!socketId) return undefined;
    return db.prepare("SELECT * FROM active_sessions WHERE socket_id = ?").get(socketId) ?? undefined;
  },
  findByUserId(userId) {
    return db.prepare("SELECT * FROM active_sessions WHERE user_id = ?").get(userId) ?? undefined;
  },
  /** @param {string} resumePlain 64 hex */
  findByResumeToken(resumePlain) {
    const h = hashToken(resumePlain);
    return db.prepare("SELECT * FROM active_sessions WHERE resume_token_hash = ?").get(h) ?? undefined;
  },
  findByChannelId(channelId) {
    return db.prepare("SELECT * FROM active_sessions WHERE channel_id = ?").all(channelId);
  },
  findAll() {
    return db.prepare("SELECT * FROM active_sessions").all();
  },
  count() {
    return /** @type {{ c: number }} */ (db.prepare("SELECT COUNT(*) AS c FROM active_sessions").get()).c;
  },
  removeBySocketId(socketId) {
    if (!socketId) return Promise.resolve();
    db.prepare("DELETE FROM active_sessions WHERE socket_id = ?").run(socketId);
    return Promise.resolve();
  },
  removeByUserId(userId) {
    db.prepare("DELETE FROM active_sessions WHERE user_id = ?").run(userId);
    return Promise.resolve();
  },
  removeAll() {
    db.prepare("DELETE FROM active_sessions").run();
    return Promise.resolve();
  },
  updateMaxComments(socketId, maxComments) {
    if (!socketId) return Promise.resolve();
    db.prepare("UPDATE active_sessions SET max_comments = ? WHERE socket_id = ?").run(maxComments, socketId);
    return Promise.resolve();
  },
  /**
   * PM2 リロード直後など socket_id が空でもユーザー単位で上限を更新する
   */
  updateMaxCommentsForUser(userId, maxComments) {
    db.prepare("UPDATE active_sessions SET max_comments = ? WHERE user_id = ?").run(maxComments, userId);
    return Promise.resolve();
  },
  updateSocketIdByTokenHash(tokenHash, socketId) {
    db.prepare("UPDATE active_sessions SET socket_id = ? WHERE token_hash = ?").run(socketId, tokenHash);
    return Promise.resolve();
  },
};

// ─────────────────────────────────────────────
// AllowedPrincipal CRUD
// ─────────────────────────────────────────────

export const AllowedPrincipalDB = {
  add(type, id, guildId) {
    const run = db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO allowed_principals (type, id, guild_id) VALUES (?,?,?)`,
      ).run(type, id, guildId);
    });
    run();
    return Promise.resolve();
  },
  remove(type, id, guildId) {
    db.prepare(
      `DELETE FROM allowed_principals WHERE type = ? AND id = ? AND guild_id = ?`,
    ).run(type, id, guildId);
    return Promise.resolve();
  },
  findByGuild(guildId) {
    return db.prepare(
      "SELECT type, id, guild_id FROM allowed_principals WHERE guild_id = ?",
    ).all(guildId);
  },
  /**
   * @param {import("discord.js").GuildMember} member
   */
  isAllowed(member) {
    const guildId    = member.guild.id;
    const principals = db.prepare(
      "SELECT type, id FROM allowed_principals WHERE guild_id = ?",
    ).all(guildId);
    if (principals.length === 0) return false;
    for (const p of principals) {
      if (p.type === "user" && p.id === member.id)           return true;
      if (p.type === "role" && member.roles.cache.has(p.id)) return true;
    }
    return false;
  },
};

export const SetupPrincipalDB = {
  add(type, id, guildId) {
    const run = db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO setup_principals (type, id, guild_id) VALUES (?,?,?)`,
      ).run(type, id, guildId);
    });
    run();
    return Promise.resolve();
  },
  remove(type, id, guildId) {
    db.prepare(
      `DELETE FROM setup_principals WHERE type = ? AND id = ? AND guild_id = ?`,
    ).run(type, id, guildId);
    return Promise.resolve();
  },
  findByGuild(guildId) {
    return db.prepare(
      "SELECT type, id, guild_id FROM setup_principals WHERE guild_id = ?",
    ).all(guildId);
  },
  isAllowed(member) {
    const guildId = member.guild.id;
    const principals = db.prepare(
      "SELECT type, id FROM setup_principals WHERE guild_id = ?",
    ).all(guildId);
    for (const p of principals) {
      if (p.type === "user" && p.id === member.id)           return true;
      if (p.type === "role" && member.roles.cache.has(p.id)) return true;
    }
    return false;
  },
};

export const DenyChannelDB = {
  add(guildId, channelId, addedBy) {
    let ok = false;
    const txn = db.transaction(() => {
      const exists = db.prepare(
        "SELECT 1 FROM deny_channels WHERE guild_id = ? AND channel_id = ?",
      ).get(guildId, channelId);
      if (exists) return;
      db.prepare(
        `INSERT INTO deny_channels (guild_id, channel_id, added_by, added_at) VALUES (?,?,?,?)`,
      ).run(guildId, channelId, addedBy, Date.now());
      ok = true;
    });
    txn();
    return Promise.resolve(ok);
  },
  remove(guildId, channelId) {
    const info = db.prepare(
      "DELETE FROM deny_channels WHERE guild_id = ? AND channel_id = ?",
    ).run(guildId, channelId);
    return Promise.resolve(info.changes > 0);
  },
  has(guildId, channelId) {
    return !!db.prepare(
      "SELECT 1 FROM deny_channels WHERE guild_id = ? AND channel_id = ?",
    ).get(guildId, channelId);
  },
  findByGuild(guildId) {
    return db.prepare(
      "SELECT guild_id, channel_id, added_by, added_at FROM deny_channels WHERE guild_id = ?",
    ).all(guildId);
  },
};

const GUILD_DEFAULT = (guildId) => ({
  guild_id:                 guildId,
  blacklist_status_enabled: false,
  blacklist_appeal_url:     "",
});

export const GuildSettingDB = {
  /**
   * @param {string} guildId
   * @returns {GuildSettingPlain & { guild_id: string }}
   */
  find(guildId) {
    const row = db.prepare(
      "SELECT settings_ciphertext FROM guild_settings WHERE guild_id = ?",
    ).get(guildId);
    if (!row) return GUILD_DEFAULT(guildId);
    try {
      const keyHex = deriveGuildSettingsKeyHex(guildId);
      const plain  = decrypt(row.settings_ciphertext, keyHex);
      const o      = JSON.parse(plain);
      return {
        guild_id:                 guildId,
        blacklist_status_enabled: !!o.blacklist_status_enabled,
        blacklist_appeal_url:     String(o.blacklist_appeal_url ?? ""),
      };
    } catch {
      console.warn(`[GuildSettingDB] 復号に失敗したためデフォルトを使用します (guild ${guildId.slice(0, 8)}…)`);
      return GUILD_DEFAULT(guildId);
    }
  },
  /**
   * @param      {string} guildId
   * @param      {Partial<GuildSettingPlain>} patch
   * @returns {Promise<GuildSettingPlain & { guild_id: string }>}
   */
  async upsert(guildId, patch) {
    const cur = this.find(guildId);
    const next = {
      ...cur,
      ...patch,
      guild_id: guildId,
    };
    const keyHex = deriveGuildSettingsKeyHex(guildId);
    const payload = JSON.stringify({
      blacklist_status_enabled: next.blacklist_status_enabled,
      blacklist_appeal_url:     next.blacklist_appeal_url,
    });
    const ct = encrypt(payload, keyHex);
    const txn = db.transaction(() => {
      db.prepare(
        `INSERT INTO guild_settings (guild_id, settings_ciphertext) VALUES (?,?)
         ON CONFLICT(guild_id) DO UPDATE SET settings_ciphertext = excluded.settings_ciphertext`,
      ).run(guildId, ct);
    });
    txn();
    return next;
  },
};

export const GlobalBlacklistDB = {
  add(userId, addedBy, reason = "", expiresAt = null, addedInGuildId = "") {
    let ok = false;
    const txn = db.transaction(() => {
      const exists = db.prepare("SELECT 1 FROM global_blacklist WHERE user_id = ?").get(userId);
      if (exists) return;
      db.prepare(
        `INSERT INTO global_blacklist
         (user_id, added_by, added_at, reason, expires_at, added_in_guild_id)
         VALUES (?,?,?,?,?,?)`,
      ).run(userId, addedBy, Date.now(), reason, expiresAt, addedInGuildId);
      ok = true;
    });
    txn();
    return Promise.resolve(ok);
  },
  remove(userId) {
    const info = db.prepare("DELETE FROM global_blacklist WHERE user_id = ?").run(userId);
    return Promise.resolve(info.changes > 0);
  },
  has(userId) {
    const now = Date.now();
    const row = db.prepare(
      "SELECT expires_at FROM global_blacklist WHERE user_id = ?",
    ).get(userId);
    if (!row) return false;
    return row.expires_at == null || row.expires_at > now;
  },
  findAll() {
    const now = Date.now();
    return db.prepare(
      "SELECT * FROM global_blacklist WHERE expires_at IS NULL OR expires_at > ?",
    ).all(now);
  },
  find(userId) {
    const now = Date.now();
    return db.prepare(
      "SELECT * FROM global_blacklist WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)",
    ).get(userId, now);
  },
};

export const LocalBlacklistDB = {
  add(userId, guildId, addedBy, reason = "", expiresAt = null) {
    let ok = false;
    const txn = db.transaction(() => {
      const exists = db.prepare(
        "SELECT 1 FROM local_blacklist WHERE user_id = ? AND guild_id = ?",
      ).get(userId, guildId);
      if (exists) return;
      db.prepare(
        `INSERT INTO local_blacklist
         (user_id, guild_id, added_by, added_at, reason, expires_at)
         VALUES (?,?,?,?,?,?)`,
      ).run(userId, guildId, addedBy, Date.now(), reason, expiresAt);
      ok = true;
    });
    txn();
    return Promise.resolve(ok);
  },
  remove(userId, guildId) {
    const info = db.prepare(
      "DELETE FROM local_blacklist WHERE user_id = ? AND guild_id = ?",
    ).run(userId, guildId);
    return Promise.resolve(info.changes > 0);
  },
  has(userId, guildId) {
    const now = Date.now();
    const row = db.prepare(
      "SELECT expires_at FROM local_blacklist WHERE user_id = ? AND guild_id = ?",
    ).get(userId, guildId);
    if (!row) return false;
    return row.expires_at == null || row.expires_at > now;
  },
  findByGuild(guildId) {
    const now = Date.now();
    return db.prepare(
      "SELECT * FROM local_blacklist WHERE guild_id = ? AND (expires_at IS NULL OR expires_at > ?)",
    ).all(guildId, now);
  },
  find(userId, guildId) {
    const now = Date.now();
    return db.prepare(
      "SELECT * FROM local_blacklist WHERE user_id = ? AND guild_id = ? AND (expires_at IS NULL OR expires_at > ?)",
    ).get(userId, guildId, now);
  },
};

export const BlacklistDB = GlobalBlacklistDB;

// ─────────────────────────────────────────────
// PM2 / グレースフルシャットダウン用
// ─────────────────────────────────────────────

/**
 * リロード時にソケット ID のみ無効化し、アクティブ・待機セッションの論理データは保持する
 */
export function flushSessionsForProcessRestart() {
  const txn = db.transaction(() => {
    db.prepare("UPDATE active_sessions SET socket_id = '' WHERE socket_id != ''").run();
    db.prepare("UPDATE pending_auths SET socket_id = '' WHERE socket_id != ''").run();
  });
  txn();
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* ignore */
  }
}

export function closeDatabase() {
  try {
    db.close();
  } catch {
    /* ignore */
  }
}

/**
 * @returns {{ pending: number, active: number }}
 */
export function getRestoredSessionCounts() {
  return {
    pending: /** @type {{ c: number }} */ (db.prepare("SELECT COUNT(*) AS c FROM pending_auths").get()).c,
    active:  /** @type {{ c: number }} */ (db.prepare("SELECT COUNT(*) AS c FROM active_sessions").get()).c,
  };
}
