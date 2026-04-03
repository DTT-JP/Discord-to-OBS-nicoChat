# ALLOWED_ORIGINS（CORS運用）

このドキュメントは**セルフホスト運用向け**です。  
公開BOT利用時は通常、設定変更は不要です。

Socket.io の接続時に `Origin` ヘッダを検証するための設定です。  
実装の最終判定は `utils/corsPolicy.js` と `socket/server.js` を正とします。

## 主要な環境変数

| 変数 | 役割 | 本番での推奨 |
|---|---|---|
| `NODE_ENV` / `APP_ENV` | 実行環境判定 | `production` |
| `ALLOWED_ORIGINS` | 許可するオリジン一覧（カンマ区切り） | 必須（1件以上） |
| `ALLOW_NULL_ORIGIN` | Originなし接続の許可 | OBS利用時は `1` 推奨 |
| `PUBLIC_URL` | 外部公開URL | HTTPS URLを設定 |
| `ENABLE_HSTS` | HSTS強制有効化 | 必要時に `1` |

## `ALLOWED_ORIGINS` の書式

- 指定できるのは **オリジンのみ**（スキーム + ホスト + ポート）。
- パス・クエリ・フラグメント（`#`）は指定できません。
- ワイルドカード `*` は利用できません。

例:

```env
ALLOWED_ORIGINS=https://overlay.example.com,https://overlay.example.com:8443
```

## Originなし接続（null origin）

OBS ブラウザソースでは `Origin` が付かない場合があります。

- 本番環境: 既定は拒否。OBS利用時は `ALLOW_NULL_ORIGIN=1` を設定。
- 開発環境: 既定は許可。厳格化したい場合は `ALLOW_NULL_ORIGIN=0`。

## 本番チェック

1. `NODE_ENV=production` を設定する
2. `ALLOWED_ORIGINS` に実運用のオリジンを列挙する
3. OBS利用時は `ALLOW_NULL_ORIGIN=1` を設定する
4. HTTPS運用時は `PUBLIC_URL=https://...` を設定する

## ローカル開発時の補足

- `ALLOWED_ORIGINS` 未設定時は `localhost` / `127.0.0.1` / `[::1]` 系が許可されます。
- 明示指定する場合は次のように設定します。

```env
ALLOWED_ORIGINS=http://localhost:3000
```
