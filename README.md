# Discord-to-OBS-nicoChat

Discord のメッセージを、ニコニコ動画風コメントとして OBS に表示する BOT です。  
通常は**公開BOTを招待して使う運用**が簡単で、**セルフホストは必要な場合のみ**選ぶ前提で構成しています。

## まずどちらで使うか

### 1) 公開BOTを使う（推奨）

インフラ運用なしで、すぐに使い始めたい方向けです。

- 招待URL: [https://discord.com/oauth2/authorize?client_id=1484621724015399032](https://discord.com/oauth2/authorize?client_id=1484621724015399032)
- 使い方は `「公開BOTの最短手順」` を参照

### 2) 自分で立てる（セルフホスト）

次のような要件がある場合に向いています。

- 独自ドメインや独自インフラで運用したい
- 動作をカスタマイズしたい
- セキュリティポリシー上、自前管理が必要

## このREADMEの方針

- 「公開BOT利用」を先に、セルフホスト手順を後に記載しています
- 一部の内部運用用コマンドは意図的に記載していません
- 最終仕様はソースコード（`index.js` / `events/interactionCreate.js` / `commands/*.js`）を正とします

## ドキュメント索引

| ドキュメント | 内容 |
|---|---|
| [docs/environment.md](docs/environment.md) | `.env` 設定ガイド |
| [docs/ALLOWED_ORIGINS.md](docs/ALLOWED_ORIGINS.md) | CORS / `ALLOWED_ORIGINS` 運用 |
| [docs/message-format.md](docs/message-format.md) | メタデータ書式・表示ルール |
| [docs/https-publication.md](docs/https-publication.md) | HTTPS公開手順（Cloudflare / nginx） |
| [docs/security.md](docs/security.md) | セキュリティ要点 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | よくある不具合と対処 |
| [docs/directory-structure.md](docs/directory-structure.md) | ディレクトリ構成 |

## 主な機能

- Discord チャンネルのメッセージを OBS にリアルタイム表示
- ニコニコ動画風スクロール表示（文字数ベースで速度調整）
- `? ... ?` メタデータによる色・サイズ・位置指定
- 6桁コードを使った認証フロー（`/start` → `/auth`）
- AES-256-GCM 暗号化によるメッセージ転送
- グローバル / サーバー別ブラックリスト
- `/session` による同時表示上限の調整（1〜99999）

## 公開BOTの最短手順（推奨）

1. 公開BOTをサーバーに招待
2. 権限担当が `/config` と `/setup` を設定
3. `/start channel:#チャンネル [limit:数値]` を実行
4. DM の URL を OBS ブラウザソースへ設定
5. 表示された 6 桁コードを同じサーバーで `/auth`

公開BOTの規約:
- プライバシーポリシー: [https://d2obs.dtt.f5.si/privacy](https://d2obs.dtt.f5.si/privacy)
- 利用規約: [https://d2obs.dtt.f5.si/terms](https://d2obs.dtt.f5.si/terms)

## セルフホストする場合

公開BOTで要件を満たせない場合だけ、この章以降を実施してください。

## 動作環境（セルフホスト）

| 項目 | 要件 |
|---|---|
| Node.js | v22.0.0以上（`package.json` の `engines` 参照） |
| OS | Windows / macOS / Linux |
| Discord | Botアカウント |
| OBS Studio | ブラウザソース対応版 |

## セットアップ（セルフホスト）

### 1) リポジトリ取得

```bash
git clone https://github.com/DTT-JP/Discord-to-OBS-nicoChat.git
cd Discord-to-OBS-nicoChat
```

### 2) 依存インストール

```bash
npm install
```

### 3) `.env` 作成

```bash
cp .env.example .env
```

必須項目は `DISCORD_TOKEN` / `CLIENT_ID` / `PORT` / `HOST` / `MASTER_KEY` です。  
詳細は [docs/environment.md](docs/environment.md) を参照してください。

### 4) Discord Developer Portal 設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリを作成
2. Application ID を `CLIENT_ID` に設定
3. Botトークンを `DISCORD_TOKEN` に設定
4. `SERVER MEMBERS INTENT` / `MESSAGE CONTENT INTENT` を有効化
5. OAuth2 で `bot` と `applications.commands` を付与して招待

### 5) スラッシュコマンド登録

```bash
npm run deploy-commands
```

グローバルコマンドの反映には最大約1時間かかる場合があります。  
`commands/*.js` の定義変更後は再登録が必要です。

## 起動

```bash
npm start
```

開発時:

```bash
npm run dev
```

## 使い方（セルフホスト）

1. 権限担当が `/config` と `/setup` で運用権限を設定
2. `/start channel:#チャンネル [limit:数値]` を実行
3. DM で届く URL を OBS ブラウザソースへ設定
4. 表示される 6 桁コードを同じサーバーで `/auth`
5. 認証後、オーバーレイ表示を開始

補足:

- `/auth` は DM では実行できません
- メタデータ書式は [docs/message-format.md](docs/message-format.md) を参照

## 公開コマンドリファレンス

このセクションは公開情報のみを記載しています。

### 一般（グローバルBL対象外ユーザー）

| コマンド | 説明 |
|---|---|
| `/help` | ヘルプ表示 |
| `/status` | CPU・メモリ・バージョン・セッション情報 |
| `/my-status` | 自分のBL照会（サーバー設定が有効な場合） |

### `/start` 許可ユーザー、またはサーバーオーナー・管理者

| コマンド | 説明 |
|---|---|
| `/start` | セッション開始（DMにURLを送信） |
| `/auth` | 6桁コード認証（同じサーバー内、DM不可） |
| `/session` | 自分のセッション設定変更（`limit` など） |

### サーバーオーナー・管理者のみ

| コマンド | 説明 |
|---|---|
| `/config` | `/setup` と `/blacklist` 操作権限の管理 |

### サーバーオーナー・管理者、または許可済み担当

| コマンド | 説明 |
|---|---|
| `/setup` | `/start` 許可対象、拒否チャンネルなどの設定 |
| `/blacklist` | サーバー別ブラックリスト管理と照会設定 |

### 製作者専用（`BOT_OWNER_ID`）

| コマンド | 説明 |
|---|---|
| `/global_blacklist` | グローバルBL管理 |
| `/global_guild_blacklist` | グローバルギルドBL管理 |

## OBS設定の目安

1. ソース追加 → ブラウザ
2. URL に `/start` の DM で受け取ったURLを設定
3. 幅・高さを配信解像度に合わせる（例: 1920x1080）
4. カスタムCSSは空で可
5. 「ページが表示されなくなったときにブラウザをシャットダウン」はオフ推奨

## HTTPS公開（セルフホスト）

外部公開する場合は [docs/https-publication.md](docs/https-publication.md) を参照してください。  
本番では `NODE_ENV=production` と `ALLOWED_ORIGINS` 設定が必須です。

## バージョン

`utils/version.js` の `VERSION` を変更して再起動すると `/status` へ反映されます。

## 補足ドキュメント

- ディレクトリ構成: [docs/directory-structure.md](docs/directory-structure.md)
- セキュリティ: [docs/security.md](docs/security.md)
- トラブルシューティング: [docs/troubleshooting.md](docs/troubleshooting.md)

## お問い合わせ

Issue からお願いします。
