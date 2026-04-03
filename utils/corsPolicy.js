/**
 * Socket.io / ブラウザからの WebSocket・ポーリング接続における Origin（CORS）ポリシー。
 *
 * ## ALLOWED_ORIGINS の設計
 *
 * - **目的**: `Origin` ヘッダが付く接続（通常のブラウザタブ・一部埋め込み）について、
 *   信頼する「スキーム + ホスト + ポート」のみを列挙する。
 * - **形式**: カンマ区切り。各要素は **オリジン** のみ（パス・クエリ・フラグメントは不可）。
 *   例: `https://overlay.example.com,https://www.example.com`
 * - **比較**: サーバー側で `new URL(設定値).origin` に正規化し、リクエストの `Origin` と完全一致比較する。
 *   末尾スラッシュは正規化で除去される。
 * - **ワイルドカード**: 使用しない（`*` は拒否）。
 * - **OBS ブラウザソース**: 多くの環境で `Origin` が送られない（null / undefined）。これは本リストには含めず、
 *   **`ALLOW_NULL_ORIGIN`** で別フラグ管理する（本番では既定拒否、明示的に許可する）。
 *
 * ## null origin（Origin ヘッダなし）の運用
 *
 * - ブラウザ以外のクライアントや、OBS の CEF 等では `Origin` が欠落することがある。
 * - **本番 (`NODE_ENV=production` または `APP_ENV=production`)**:
 *   - 既定では **null origin を拒否**する（意図しないクライアントの接続を減らす）。
 *   - OBS でオーバーレイを使う場合は **`ALLOW_NULL_ORIGIN=1`**（または `true` / `yes`）を必ず設定する。
 * - **非本番**: ローカル検証のため **既定で null origin を許可**する。
 *   - 厳格にしたい場合は **`ALLOW_NULL_ORIGIN=0`**（または `false` / `no`）で拒否できる。
 *
 * ## 本番向けの強制ルール
 *
 * - `ALLOWED_ORIGINS` は **1 件以上必須**（ブラウザからオーバーレイ URL を開く場合のオリジンを含める）。
 * - 各オリジンは **有効な絶対 URL** であること。
 * - `http://` は **localhost / 127.0.0.1 / [::1] のみ**許可（それ以外の http は本番では拒否）。
 *
 * ## ローカル開発（非本番）
 *
 * - `ALLOWED_ORIGINS` 未設定時は、`Origin` 付きの接続について **localhost 系オリジンのみ**追加で許可する
 *   （従来どおり `http://localhost:PORT` での検証用）。
 */

/**
 * @returns {boolean}
 */
export function isProduction() {
  const nodeEnv = (process.env.NODE_ENV || "").toLowerCase().trim();
  const appEnv  = (process.env.APP_ENV || "").toLowerCase().trim();
  return nodeEnv === "production" || appEnv === "production";
}

/**
 * @param {string} [raw]
 * @returns {string[]}
 */
export function parseAllowedOriginsList(raw) {
  if (!raw?.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {string} originUrl
 * @returns {boolean}
 */
export function isLocalhostStyleOrigin(originUrl) {
  try {
    const { hostname: host } = new URL(originUrl);
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * @param {string} entry
 * @param {{ production: boolean }} opts
 * @returns {string} 正規化された origin（例 https://host:443 → https://host）
 */
export function normalizeAllowedOriginEntry(entry, opts) {
  let u;
  try {
    u = new URL(entry);
  } catch {
    throw new Error(`ALLOWED_ORIGINS の値が URL として解釈できません: ${entry}`);
  }

  if (u.username || u.password) {
    throw new Error(`ALLOWED_ORIGINS にユーザー情報を含めないでください: ${entry}`);
  }

  const path = u.pathname;
  if (path !== "" && path !== "/") {
    throw new Error(`ALLOWED_ORIGINS はオリジンのみ（パス不可）: ${entry}`);
  }

  if (u.search || u.hash) {
    throw new Error(`ALLOWED_ORIGINS にクエリ・ハッシュを含めないでください: ${entry}`);
  }

  const origin = u.origin;

  if (entry.includes("*")) {
    throw new Error("ALLOWED_ORIGINS にワイルドカード * は使用できません");
  }

  if (opts.production) {
    if (origin.startsWith("http://") && !isLocalhostStyleOrigin(origin)) {
      throw new Error(
        `本番では http は localhost 系以外使用できません: ${entry}`,
      );
    }
  }

  return origin;
}

/**
 * @param {string[]} entries
 * @param {{ production: boolean }} opts
 * @returns {string[]}
 */
export function validateAndNormalizeAllowedOrigins(entries, opts) {
  const out = [];
  for (const e of entries) {
    out.push(normalizeAllowedOriginEntry(e, opts));
  }
  return [...new Set(out)];
}

/**
 * 本番では ALLOWED_ORIGINS 必須など、起動時に一度だけ検証する。
 */
export function assertCorsEnvForStartup() {
  const production = isProduction();
  const rawList    = parseAllowedOriginsList(process.env.ALLOWED_ORIGINS || "");

  if (production) {
    if (rawList.length === 0) {
      console.error(
        "[init] 本番モード: ALLOWED_ORIGINS に、オーバーレイを公開する URL のオリジンを1件以上カンマ区切りで設定してください（例: https://overlay.example.com）。",
      );
      process.exit(1);
    }
    try {
      validateAndNormalizeAllowedOrigins(rawList, { production: true });
    } catch (err) {
      console.error("[init] ALLOWED_ORIGINS の検証に失敗しました:", err instanceof Error ? err.message : err);
      process.exit(1);
    }

    const nullAllowed = isAllowNullOriginEnabled();
    if (!nullAllowed) {
      console.warn(
        "[init] 本番: ALLOW_NULL_ORIGIN が無効のため、Origin ヘッダ無し接続（多くの OBS ブラウザソース）は拒否されます。OBS を使う場合は ALLOW_NULL_ORIGIN=1 を .env に追加してください。",
      );
    }
  } else if (rawList.length > 0) {
    try {
      validateAndNormalizeAllowedOrigins(rawList, { production: false });
    } catch (err) {
      console.error("[init] ALLOWED_ORIGINS の検証に失敗しました:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
}

/**
 * null origin を許可するか（本番は明示 true のみ、非本番は明示 false でのみ拒否）
 * @returns {boolean}
 */
export function isAllowNullOriginEnabled() {
  const v = (process.env.ALLOW_NULL_ORIGIN || "").toLowerCase().trim();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  if (isProduction()) return false;
  return true;
}

/**
 * Socket.io の cors.origin コールバック用に解決済み設定を返す
 * @returns {{ allowedOrigins: string[], allowNullOrigin: boolean, allowLocalhostFallback: boolean }}
 */
export function resolveCorsConfigForSocketIo() {
  const production = isProduction();
  const rawList    = parseAllowedOriginsList(process.env.ALLOWED_ORIGINS || "");

  let allowedOrigins = [];
  if (rawList.length > 0) {
    allowedOrigins = validateAndNormalizeAllowedOrigins(rawList, { production });
  } else if (production) {
    // assertCorsEnvForStartup で弾いている想定
    throw new Error("ALLOWED_ORIGINS が空です（本番）");
  }

  return {
    allowedOrigins,
    allowNullOrigin:          isAllowNullOriginEnabled(),
    allowLocalhostFallback:   !production && allowedOrigins.length === 0,
  };
}

/**
 * @param {string | undefined} origin
 */
export function isLocalDevOrigin(origin) {
  if (!origin) return false;
  try {
    const { hostname: host } = new URL(origin);
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}
