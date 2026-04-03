# 環境変数（詳細）

`.env.example` と `index.js` の必須チェックがソースの正です。本番では `NODE_ENV=production` と CORS 関連を必ず確認してください。

## 必須（起動時に未設定だと終了）

| 変数 | 説明 |
|---|---|
| `DISCORD_TOKEN` | Bot トークン |
| `CLIENT_ID` | アプリケーション ID |
| `PORT` | HTTP/Socket.io のポート |
| `HOST` | URL 生成用ホスト名（`PUBLIC_URL` 未設定時） |
| `MASTER_KEY` | 64 hex または任意文字列（ギルド設定の暗号化に使用） |

## CORS・HTTPS（本番で重要）

| 変数 | 説明 |
|---|---|
| `NODE_ENV` / `APP_ENV` | `production` で CORS 本番ルール |
| `ALLOWED_ORIGINS` | 本番では必須（1 件以上）。詳細は [ALLOWED_ORIGINS.md](./ALLOWED_ORIGINS.md) |
| `ALLOW_NULL_ORIGIN` | OBS 等の Origin 無し接続。本番では未設定＝拒否 |
| `PUBLIC_URL` | `https://` で始まると Helmet の HSTS が有効になりやすい |
| `ENABLE_HSTS` | `1` で HSTS を明示有効 |

## Bot 運用

スラッシュコマンドの定義（`commands/*.js`）を変えたあとは、**`npm run deploy-commands`** で Discord へ再登録してください（グローバル登録の反映には最大約 1 時間かかる場合があります）。

| 変数 | 説明 |
|---|---|
| `BOT_OWNER_ID` | `/global_blacklist` 等の製作者専用コマンドに使用 |
| `GLOBAL_BLACKLIST_APPEAL_URL` | `/my-status` での表示用 |
| `GLOBAL_GUILD_BLACKLIST_APPEAL_URL` | `/global_guild_blacklist` の DM表示用 |
| `MAX_COMMENTS` | デフォルト同時表示上限 |
| `CODE_EXPIRE_MINUTES` | 認証待ちトークンの有効期限 |
| `AUTH_CODE_PEPPER` | 未設定時は起動ごとにランダム（`utils/crypto.js`）。本番では固定値推奨 |

## データベース

- 既定の DB ファイルはプロジェクト直下の `app.db`（WAL モード）。
- 旧 `db.json` は初回など条件で SQLite にマージされます。
