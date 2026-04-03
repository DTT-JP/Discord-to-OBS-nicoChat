# ALLOWED_ORIGINS / CORS 運用ガイド

Socket.io（WebSocket・ロングポーリング）の **`Origin` ヘッダ** を検証するための設定です。実装は `utils/corsPolicy.js` と `socket/server.js` を参照してください。

## 環境変数一覧

| 変数 | 本番での扱い | 説明 |
|------|----------------|------|
| `NODE_ENV` または `APP_ENV` | `production` のとき本番ルールが有効 | 例: `NODE_ENV=production` |
| `ALLOWED_ORIGINS` | **必須（1件以上）** | 許可するブラウザオリジンをカンマ区切り。例: `https://overlay.example.com` |
| `ALLOW_NULL_ORIGIN` | OBS 利用時は **`1` 推奨** | `Origin` 無し接続を許可。未設定時、本番では **拒否**、非本番では **許可** |
| `PUBLIC_URL` | HTTPS 公開時に設定推奨 | `https://...` のとき Helmet の **HSTS** が有効になる |
| `ENABLE_HSTS` | 任意 | `1` のとき `PUBLIC_URL` が http でも HSTS を付与（リバプロ HTTPS 時など） |

## ALLOWED_ORIGINS の書き方

- **オリジンのみ**（スキーム + ホスト + ポート）。**パス・クエリ・`#` は不可**。
- 正しい例: `https://obs.example.com` , `https://obs.example.com:8443`
- 誤り: `https://obs.example.com/`（末尾スラッシュは内部で正規化されるが、パス付きは不可）
- **ワイルドカード `*` は不可**。

## null origin（Origin ヘッダが付かない接続）

OBS ブラウザソースなどでは `Origin` が送られないことがあります。

- **本番**: 既定では **拒否**。OBS を使う場合は **`ALLOW_NULL_ORIGIN=1`**（または `true` / `yes`）を設定する。
- **開発**: 既定 **許可**。厳格にしたい場合は **`ALLOW_NULL_ORIGIN=0`**。

## 本番チェックリスト

1. `NODE_ENV=production`
2. `ALLOWED_ORIGINS` に実際にブラウザで開くオーバーレイ URL のオリジンを列挙
3. OBS を使うなら `ALLOW_NULL_ORIGIN=1`
4. 公開が HTTPS なら `PUBLIC_URL=https://...` または `ENABLE_HSTS=1`

## ローカル開発

- `ALLOWED_ORIGINS` を空のままにすると、`http://localhost` / `127.0.0.1` / `[::1]` 由来の `Origin` のみ追加で許可されます（従来どおり）。
- 明示的に列挙する場合は例: `ALLOWED_ORIGINS=http://localhost:3000`
