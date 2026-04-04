# 環境変数

このドキュメントは**セルフホスト時**の `.env` 設定ガイドです。  
公開BOTを利用するだけの場合、この設定は不要です。  
最終仕様は常に `.env.example` と `index.js` のチェック処理を正とします。

## 必須項目（未設定だと起動失敗）

| 変数 | 用途 |
|---|---|
| `DISCORD_TOKEN` | Bot トークン |
| `CLIENT_ID` | Discord Application ID |
| `PORT` | HTTP / Socket.io の待ち受けポート |
| `HOST` | URL 生成用ホスト名（`PUBLIC_URL` 未設定時） |
| `MASTER_KEY` | ギルド単位設定の暗号化に使う鍵素材 |

## 本番運用で重要な項目（CORS / HTTPS）

| 変数 | 役割 |
|---|---|
| `NODE_ENV` / `APP_ENV` | `production` で本番向けCORSルールを適用 |
| `ALLOWED_ORIGINS` | 本番では必須（1件以上）。詳細は [ALLOWED_ORIGINS.md](./ALLOWED_ORIGINS.md) |
| `ALLOW_NULL_ORIGIN` | OBS など Origin なし接続の許可設定 |
| `PUBLIC_URL` | 外部公開URL。`https://` で HSTS 条件に影響 |
| `ENABLE_HSTS` | `1` で HSTS を明示有効化 |

## Bot運用向け項目

スラッシュコマンド定義（`commands/*.js`）を変更した場合は、`npm run deploy-commands` で再登録が必要です。  
グローバル反映には最大で約1時間かかる場合があります。

| 変数 | 用途 |
|---|---|
| `BOT_OWNER_ID` | 製作者専用コマンドの判定に使用 |
| `GLOBAL_BLACKLIST_APPEAL_URL` | `/my-status` 表示用URL |
| `GLOBAL_GUILD_BLACKLIST_APPEAL_URL` | グローバルギルドBL通知の表示用URL |
| `MAX_COMMENTS` | 同時表示コメント上限の既定値 |
| `CODE_EXPIRE_MINUTES` | 認証待ちトークン有効期限 |
| `AUTH_CODE_PEPPER` | 認証コード保護用ペッパー（本番は固定値推奨） |

## データベース補足

- 既定DBはプロジェクト直下の `app.db`（SQLite / WAL）。
- 旧 `db.json` は条件を満たす場合に起動時マイグレーションされます。
