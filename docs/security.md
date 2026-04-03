# セキュリティ

実装の詳細は各ソースファイルのコメントを参照してください。

## トークン認証

`/start` 実行時に UUID v4 のワンタイムトークンを発行します。トークンには有効期限（デフォルト 10 分）が設定されており、期限切れは定期クリーンアップで削除されます。

## 6桁コードによる本人確認

ブラウザ接続後に発行される 6 桁コードは、`/start` を実行したユーザーの Discord ID と照合します。URL を知っていても異なる Discord アカウントからは認証できません。

## ブルートフォース保護

`/auth` コマンドには試行回数制限があります。5 回連続で認証に失敗した場合、5 分間ロックアウトされます。

## 認証後の DOM・URL

認証完了後、OBS ブラウザ上から認証コードを DOM から除去し、可能な範囲で URL からトークンクエリを除去します（`public/script.js`）。

## AES-256-GCM

認証完了後のメッセージは AES-256-GCM で暗号化されます。クライアントは Web Crypto API で復号します。

## CORS

Socket.io の CORS は `utils/corsPolicy.js` に集約されています。詳細は [ALLOWED_ORIGINS.md](./ALLOWED_ORIGINS.md) を参照してください。

## コマンド権限（概要）

| コマンド | 権限の考え方 |
|---|---|
| `/status` | **グローバルブラックリストに入っていないユーザー**が実行可能（`events/interactionCreate.js`） |
| `/auth` `/setlimit` `/secret` | `/config` で `/start` 許可されたロール・ユーザー（`commands/auth.js` 等と同様） |
| `/setup` 系 | サーバーオーナー・管理者、または `/config` で許可されたセットアップ担当（`commands/setup.js`） |
| `/global_blacklist` | `.env` の `BOT_OWNER_ID` と一致するユーザーのみ |

## グローバル・ローカルブラックリスト

- **グローバル**: コマンド実行とオーバーレイ表示の双方を遮断（`/my-status` は例外で照会のみ可）。
- **ローカル（サーバー）**: 主に **OBS へのメッセージ表示** を遮断（コマンドは通常利用可）。

## データ永続化

設定・セッション・許可リスト等は **SQLite**（既定 `app.db`）に保存されます。旧 `db.json` は起動時に条件付きでマージ可能です（`database.js` の `migrateLegacyJsonIfNeeded`）。

ギルド単位の一部設定は `MASTER_KEY` と guild id から派生した鍵で暗号化されます（`utils/deriveGuildKey.js`）。

## メッセージの保存

Discord のメッセージ本文は暗号化して OBS に転送後、サーバー上に長期保存しません。
