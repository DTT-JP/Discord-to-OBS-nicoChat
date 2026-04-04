import { readFileSync, existsSync, statSync } from "node:fs";
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
 * @property {number|boolean} [secret_allowed]
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
 * @property {number|boolean} [secret_allowed]
 * @property {string|null} [resume_token_hash]
 */

const db = new Database(SQLITE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = FULL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 8000");

const MAX_COMMENTS_MIN = 1;
const MAX_COMMENTS_MAX = 99999;
const DEFAULT_MAX_COMMENTS = 30;

/**
 * @param {unknown} v
 * @returns {number}
 */
function clampMaxComments(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_MAX_COMMENTS;
  const t = Math.trunc(n);
  if (t < MAX_COMMENTS_MIN) return DEFAULT_MAX_COMMENTS;
  return Math.min(MAX_COMMENTS_MAX, t);
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_auths (
      token_hash   TEXT PRIMARY KEY,
      socket_id    TEXT NOT NULL DEFAULT '',
      user_id      TEXT NOT NULL,
      channel_id   TEXT NOT NULL,
      code_hash    TEXT NOT NULL DEFAULT '',
      expires_at   INTEGER NOT NULL,
      max_comments INTEGER NOT NULL,
      secret_allowed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS active_sessions (
      token_hash        TEXT PRIMARY KEY,
      socket_id         TEXT NOT NULL DEFAULT '',
      user_id           TEXT NOT NULL,
      channel_id        TEXT NOT NULL,
      aes_key           TEXT NOT NULL,
      created_at        INTEGER NOT NULL,
      max_comments      INTEGER NOT NULL,
      secret_allowed    INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS blacklist_ctrl_principals (
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

    CREATE TABLE IF NOT EXISTS global_guild_blacklist (
      guild_id         TEXT PRIMARY KEY,
      guild_name       TEXT NOT NULL DEFAULT '',
      added_by         TEXT NOT NULL,
      added_at         INTEGER NOT NULL,
      public_reason    TEXT NOT NULL DEFAULT '',
      internal_reason  TEXT NOT NULL DEFAULT '',
      expires_at       INTEGER
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

    CREATE TABLE IF NOT EXISTS _meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);

  // 既存DB互換: 旧スキーマに列が無い場合は後から追加する
  const ggblCols = /** @type {{ name: string }[]} */ (db.prepare("PRAGMA table_info(global_guild_blacklist)").all());
  if (!ggblCols.some((c) => c.name === "guild_name")) {
    db.exec(`ALTER TABLE global_guild_blacklist ADD COLUMN guild_name TEXT NOT NULL DEFAULT ''`);
  }
  const pendingCols = /** @type {{ name: string }[]} */ (db.prepare("PRAGMA table_info(pending_auths)").all());
  if (!pendingCols.some((c) => c.name === "secret_allowed")) {
    db.exec(`ALTER TABLE pending_auths ADD COLUMN secret_allowed INTEGER NOT NULL DEFAULT 0`);
  }
  const activeCols = /** @type {{ name: string }[]} */ (db.prepare("PRAGMA table_info(active_sessions)").all());
  if (!activeCols.some((c) => c.name === "secret_allowed")) {
    db.exec(`ALTER TABLE active_sessions ADD COLUMN secret_allowed INTEGER NOT NULL DEFAULT 0`);
  }
}

initSchema();

function getMeta(key) {
  const row = db.prepare("SELECT v FROM _meta WHERE k = ?").get(key);
  return row?.v ?? null;
}

function setMeta(key, value) {
  db.prepare(
    `INSERT INTO _meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
  ).run(key, value);
}

/**
 * 旧 lowdb の db.json ルートを正規化する（`blacklist` → `global_blacklist` など）
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
function normalizeLegacyJsonRoot(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = /** @type {Record<string, unknown>} */ ({ ...raw });

  const gb = data.global_blacklist;
  const hasGb = Array.isArray(gb) && gb.length > 0;
  const bl  = data.blacklist;
  if (!hasGb && Array.isArray(bl) && bl.length > 0) {
    data.global_blacklist = bl.map((e) => {
      const x = /** @type {Record<string, unknown>} */ (e && typeof e === "object" ? e : {});
      return {
        user_id:           String(x.user_id ?? ""),
        added_by:          String(x.added_by ?? ""),
        added_at:          typeof x.added_at === "number" ? x.added_at : Date.now(),
        reason:            String(x.reason ?? ""),
        expires_at:        x.expires_at == null ? null : Number(x.expires_at),
        added_in_guild_id: String(x.added_in_guild_id ?? ""),
      };
    });
  }

  return data;
}

/**
 * db.json が存在し、前回取り込み以降に更新されていれば SQLite へマージする（1 トランザクション）。
 * - pending / active が空でない SQLite でも、許可ロール・ギルド設定・BL などは取り込める。
 * - `db.json` の mtime を `_meta.legacy_json_mtime` に保存し、未変更ならスキップ（高速起動）。
 * - 手動で db.json を編集した場合は mtime が変わるため再マージされる（INSERT OR IGNORE で重複は無視）。
 */
export function migrateLegacyJsonIfNeeded() {
  if (!existsSync(LEGACY_JSON)) return;

  let st;
  try {
    st = statSync(LEGACY_JSON);
  } catch {
    return;
  }

  const mtimeKey = String(st.mtimeMs);
  if (getMeta("legacy_json_mtime") === mtimeKey) return;

  let raw;
  try {
    raw = JSON.parse(readFileSync(LEGACY_JSON, "utf8"));
  } catch (err) {
    console.warn(
      "[database] db.json の読み込みに失敗しました（移行スキップ）:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const data = normalizeLegacyJsonRoot(raw);
  if (!data) {
    console.warn("[database] db.json のルートがオブジェクトではないため移行をスキップしました");
    return;
  }

  const insPending = db.prepare(
    `INSERT OR IGNORE INTO pending_auths
     (token_hash, socket_id, user_id, channel_id, code_hash, expires_at, max_comments, secret_allowed)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  const insActive = db.prepare(
    `INSERT OR IGNORE INTO active_sessions
     (token_hash, socket_id, user_id, channel_id, aes_key, created_at, max_comments, secret_allowed, resume_token_hash)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  const insAllowed = db.prepare(
    `INSERT OR IGNORE INTO allowed_principals (type, id, guild_id) VALUES (?,?,?)`,
  );
  const insSetup = db.prepare(
    `INSERT OR IGNORE INTO setup_principals (type, id, guild_id) VALUES (?,?,?)`,
  );
  const insBlacklistCtrl = db.prepare(
    `INSERT OR IGNORE INTO blacklist_ctrl_principals (type, id, guild_id) VALUES (?,?,?)`,
  );
  const insDeny = db.prepare(
    `INSERT OR IGNORE INTO deny_channels (guild_id, channel_id, added_by, added_at) VALUES (?,?,?,?)`,
  );
  const insGuild = db.prepare(
    `INSERT OR IGNORE INTO guild_settings (guild_id, settings_ciphertext) VALUES (?,?)`,
  );
  const insGbl = db.prepare(
    `INSERT OR IGNORE INTO global_blacklist
     (user_id, added_by, added_at, reason, expires_at, added_in_guild_id)
     VALUES (?,?,?,?,?,?)`,
  );
  const insGgbl = db.prepare(
    `INSERT OR IGNORE INTO global_guild_blacklist
     (guild_id, guild_name, added_by, added_at, public_reason, internal_reason, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
  );
  const insLoc = db.prepare(
    `INSERT OR IGNORE INTO local_blacklist
     (user_id, guild_id, added_by, added_at, reason, expires_at)
     VALUES (?,?,?,?,?,?)`,
  );

  let changeCount = 0;
  const bump = (info) => {
    changeCount += info.changes;
  };

  try {
    const txn = db.transaction(() => {
      for (const r of /** @type {unknown[]} */ (data.pending_auths ?? [])) {
        if (!r || typeof r !== "object") continue;
        const row = /** @type {Record<string, unknown>} */ (r);
        const th = String(row.token_hash || (row.token ? hashToken(String(row.token)) : ""));
        if (!th || !row.user_id || !row.channel_id || row.expires_at == null) continue;
        const uid = String(row.user_id);
        bump(
          insPending.run(
            th,
            String(row.socket_id ?? ""),
            uid,
            String(row.channel_id),
            String(row.code_hash || (row.code ? hashAuthCode(String(row.code), uid) : "")),
            Number(row.expires_at),
            clampMaxComments(row.max_comments ?? 30),
            row.secret_allowed === true ? 1 : 0,
          ),
        );
      }

      for (const r of /** @type {unknown[]} */ (data.active_sessions ?? [])) {
        if (!r || typeof r !== "object") continue;
        const row = /** @type {Record<string, unknown>} */ (r);
        const th = String(row.token_hash || (row.token ? hashToken(String(row.token)) : ""));
        if (!th || !row.aes_key || !row.user_id || !row.channel_id) continue;
        bump(
          insActive.run(
            th,
            String(row.socket_id ?? ""),
            String(row.user_id),
            String(row.channel_id),
            String(row.aes_key),
            Number(row.created_at ?? Date.now()),
            clampMaxComments(row.max_comments ?? 30),
            row.secret_allowed === true ? 1 : 0,
            row.resume_token_hash != null && row.resume_token_hash !== ""
              ? String(row.resume_token_hash)
              : null,
          ),
        );
      }

      for (const p of /** @type {unknown[]} */ (data.allowed_principals ?? [])) {
        if (!p || typeof p !== "object") continue;
        const x = /** @type {Record<string, unknown>} */ (p);
        if (!x.type || !x.id || !x.guild_id) continue;
        bump(insAllowed.run(String(x.type), String(x.id), String(x.guild_id)));
      }

      for (const p of /** @type {unknown[]} */ (data.setup_principals ?? [])) {
        if (!p || typeof p !== "object") continue;
        const x = /** @type {Record<string, unknown>} */ (p);
        if (!x.type || !x.id || !x.guild_id) continue;
        bump(insSetup.run(String(x.type), String(x.id), String(x.guild_id)));
      }

      for (const p of /** @type {unknown[]} */ (data.blacklist_ctrl_principals ?? [])) {
        if (!p || typeof p !== "object") continue;
        const x = /** @type {Record<string, unknown>} */ (p);
        if (!x.type || !x.id || !x.guild_id) continue;
        bump(insBlacklistCtrl.run(String(x.type), String(x.id), String(x.guild_id)));
      }

      for (const e of /** @type {unknown[]} */ (data.deny_channels ?? [])) {
        if (!e || typeof e !== "object") continue;
        const x = /** @type {Record<string, unknown>} */ (e);
        if (!x.guild_id || !x.channel_id) continue;
        bump(
          insDeny.run(
            String(x.guild_id),
            String(x.channel_id),
            String(x.added_by ?? ""),
            Number(x.added_at ?? Date.now()),
          ),
        );
      }

      for (const s of /** @type {unknown[]} */ (data.guild_settings ?? [])) {
        if (!s || typeof s !== "object") continue;
        const x = /** @type {Record<string, unknown>} */ (s);
        if (!x.guild_id) continue;
        const gid = String(x.guild_id);
        const keyHex = deriveGuildSettingsKeyHex(gid);
        const payload = JSON.stringify({
          blacklist_status_enabled: !!x.blacklist_status_enabled,
          blacklist_appeal_url:     String(x.blacklist_appeal_url ?? ""),
        });
        const ct = encrypt(payload, keyHex);
        bump(insGuild.run(gid, ct));
      }

      for (const e of /** @type {unknown[]} */ (data.global_blacklist ?? [])) {
        if (!e || typeof e !== "object") continue;
        const x = /** @type {Record<string, unknown>} */ (e);
        if (!x.user_id) continue;
        bump(
          insGbl.run(
            String(x.user_id),
            String(x.added_by ?? ""),
            Number(x.added_at ?? Date.now()),
            String(x.reason ?? ""),
            x.expires_at == null ? null : Number(x.expires_at),
            String(x.added_in_guild_id ?? ""),
          ),
        );
      }

      for (const e of /** @type {unknown[]} */ (data.global_guild_blacklist ?? [])) {
        if (!e || typeof e !== "object") continue;
        const x = /** @type {Record<string, unknown>} */ (e);
        if (!x.guild_id) continue;
        bump(
          insGgbl.run(
            String(x.guild_id),
            String(x.guild_name ?? ""),
            String(x.added_by ?? ""),
            Number(x.added_at ?? Date.now()),
            String(x.public_reason ?? ""),
            String(x.internal_reason ?? ""),
            x.expires_at == null ? null : Number(x.expires_at),
          ),
        );
      }

      for (const e of /** @type {unknown[]} */ (data.local_blacklist ?? [])) {
        if (!e || typeof e !== "object") continue;
        const x = /** @type {Record<string, unknown>} */ (e);
        if (!x.user_id || !x.guild_id) continue;
        bump(
          insLoc.run(
            String(x.user_id),
            String(x.guild_id),
            String(x.added_by ?? ""),
            Number(x.added_at ?? Date.now()),
            String(x.reason ?? ""),
            x.expires_at == null ? null : Number(x.expires_at),
          ),
        );
      }

      setMeta("legacy_json_mtime", mtimeKey);
    });

    txn();
  } catch (err) {
    console.error(
      "[database] db.json → SQLite マージ中にエラーが発生しました（ロールバック済み）:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  console.log(
    `[database] db.json を SQLite にマージしました（新規挿入 ${changeCount} 行相当・mtime=${mtimeKey}）`,
  );
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
    const expiresAt = Number(record.expires_at);
    const safeExpiresAt = Number.isFinite(expiresAt) ? expiresAt : Date.now() + 10 * 60 * 1000; // フォールバック
    const maxComments = clampMaxComments(record.max_comments);
    const run = db.transaction(() => {
      db.prepare(
        `INSERT INTO pending_auths
         (token_hash, socket_id, user_id, channel_id, code_hash, expires_at, max_comments, secret_allowed)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        tokenHash,
        record.socket_id ?? "",
        record.user_id,
        record.channel_id,
        codeHash,
        safeExpiresAt,
        maxComments,
        record.secret_allowed === true ? 1 : 0,
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
  removeAll() {
    db.prepare("DELETE FROM pending_auths").run();
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
    const maxComments = clampMaxComments(record.max_comments);
    const createdAt = Number(record.created_at);
    const safeCreatedAt = Number.isFinite(createdAt) ? createdAt : Date.now();
    const run = db.transaction(() => {
      db.prepare(
        `INSERT INTO active_sessions
         (token_hash, socket_id, user_id, channel_id, aes_key, created_at, max_comments, secret_allowed, resume_token_hash)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        tokenHash,
        record.socket_id ?? "",
        record.user_id,
        record.channel_id,
        record.aes_key,
        safeCreatedAt,
        maxComments,
        record.secret_allowed === true ? 1 : 0,
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
  /**
   * @returns {string[]} 接続中（socket_id が空でない）チャンネルIDのみ
   */
  findDistinctConnectedChannelIds() {
    return db.prepare(
      "SELECT DISTINCT channel_id FROM active_sessions WHERE socket_id != ''",
    ).all().map((r) => r.channel_id);
  },
  count() {
    return /** @type {{ c: number }} */ (db.prepare("SELECT COUNT(*) AS c FROM active_sessions").get()).c;
  },
  removeBySocketId(socketId) {
    if (!socketId) return Promise.resolve();
    db.prepare("DELETE FROM active_sessions WHERE socket_id = ?").run(socketId);
    return Promise.resolve();
  },
  /**
   * 切断時に active_sessions を削除せず `socket_id` だけ空にします。
   * `resume_token_hash` を保持することで、リロード後も resume が可能になります。
   * @param {string} socketId
   */
  clearSocketIdBySocketId(socketId) {
    if (!socketId) return Promise.resolve(false);
    const info = db.prepare("UPDATE active_sessions SET socket_id = '' WHERE socket_id = ?").run(socketId);
    return Promise.resolve(info.changes > 0);
  },
  /**
   * `socket_id` が空の切断セッションを古いものから削除します。
   * @param {number} maxAgeMs
   */
  cleanupDisconnectedSessions(maxAgeMs) {
    const cutoff = Date.now() - Number(maxAgeMs);
    if (!Number.isFinite(cutoff)) return Promise.resolve(0);
    const info = db.prepare(
      "DELETE FROM active_sessions WHERE socket_id = '' AND created_at <= ?",
    ).run(cutoff);
    return Promise.resolve(info.changes);
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
    db.prepare("UPDATE active_sessions SET max_comments = ? WHERE socket_id = ?").run(clampMaxComments(maxComments), socketId);
    return Promise.resolve();
  },
  /**
   * PM2 リロード直後など socket_id が空でもユーザー単位で上限を更新する
   */
  updateMaxCommentsForUser(userId, maxComments) {
    db.prepare("UPDATE active_sessions SET max_comments = ? WHERE user_id = ?").run(clampMaxComments(maxComments), userId);
    return Promise.resolve();
  },
  updateSessionSettingsForOwnerInChannel(userId, channelId, patch) {
    const sets = [];
    /** @type {(number|string)[]} */
    const params = [];
    if (patch.max_comments != null) {
      sets.push("max_comments = ?");
      params.push(clampMaxComments(patch.max_comments));
    }
    if (patch.secret_allowed != null) {
      sets.push("secret_allowed = ?");
      params.push(patch.secret_allowed ? 1 : 0);
    }
    if (sets.length === 0) return Promise.resolve(0);
    params.push(userId, channelId);
    const info = db.prepare(
      `UPDATE active_sessions SET ${sets.join(", ")} WHERE user_id = ? AND channel_id = ?`,
    ).run(...params);
    return Promise.resolve(info.changes);
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

export const BlacklistCtrlPrincipalDB = {
  add(type, id, guildId) {
    const run = db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO blacklist_ctrl_principals (type, id, guild_id) VALUES (?,?,?)`,
      ).run(type, id, guildId);
    });
    run();
    return Promise.resolve();
  },
  remove(type, id, guildId) {
    db.prepare(
      `DELETE FROM blacklist_ctrl_principals WHERE type = ? AND id = ? AND guild_id = ?`,
    ).run(type, id, guildId);
    return Promise.resolve();
  },
  findByGuild(guildId) {
    return db.prepare(
      "SELECT type, id, guild_id FROM blacklist_ctrl_principals WHERE guild_id = ?",
    ).all(guildId);
  },
  isAllowed(member) {
    const guildId = member.guild.id;
    const principals = db.prepare(
      "SELECT type, id FROM blacklist_ctrl_principals WHERE guild_id = ?",
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

export const GlobalGuildBlacklistDB = {
  add(guildId, guildName = "", addedBy, publicReason = "", internalReason = "", expiresAt = null) {
    // "上書きしない"ため、既に有効期限内の登録がある場合は無視する
    // （期限切れなら新規登録として扱う）
    let inserted = false;
    const txn = db.transaction(() => {
      const now = Date.now();
      const existing = db.prepare(
        "SELECT expires_at FROM global_guild_blacklist WHERE guild_id = ?",
      ).get(guildId);

      const isStillActive = existing
        ? existing.expires_at == null || existing.expires_at > now
        : false;

      if (existing && isStillActive) return;

      if (existing && !isStillActive) {
        db.prepare("DELETE FROM global_guild_blacklist WHERE guild_id = ?").run(guildId);
      }

      db.prepare(
        `INSERT INTO global_guild_blacklist
         (guild_id, guild_name, added_by, added_at, public_reason, internal_reason, expires_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(guildId, guildName, addedBy, Date.now(), publicReason, internalReason, expiresAt);

      inserted = true;
    });

    txn();
    return Promise.resolve(inserted);
  },
  remove(guildId) {
    const info = db.prepare("DELETE FROM global_guild_blacklist WHERE guild_id = ?").run(guildId);
    return Promise.resolve(info.changes > 0);
  },
  hasGuild(guildId) {
    const now = Date.now();
    const row = db.prepare(
      "SELECT expires_at FROM global_guild_blacklist WHERE guild_id = ?",
    ).get(guildId);
    if (!row) return false;
    return row.expires_at == null || row.expires_at > now;
  },
  find(guildId) {
    const now = Date.now();
    return db.prepare(
      "SELECT * FROM global_guild_blacklist WHERE guild_id = ? AND (expires_at IS NULL OR expires_at > ?)",
    ).get(guildId, now) ?? undefined;
  },
  findAll() {
    const now = Date.now();
    return db.prepare(
      "SELECT * FROM global_guild_blacklist WHERE expires_at IS NULL OR expires_at > ?",
    ).all(now);
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
