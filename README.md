# Discord-to-OBS-nicoChat

> Discord のチャンネルをニコニコ動画風コメントで OBS にリアルタイム配信する Bot

AES-256-GCM 暗号化・2 段階認証・複数サーバー対応のセルフホスト型オーバーレイです。データは **SQLite**（`app.db`）に保存されます。

---

## 目次

- [機能一覧](#機能一覧)
- [ドキュメント索引（`docs/`）](#ドキュメント索引docs)
- [Discord への招待](#discordへの招待)
- [動作環境](#動作環境)
- [インストール手順](#インストール手順)
- [環境変数](#環境変数)
- [Discord Developer Portal](#discord-developer-portal-の設定)
- [スラッシュコマンドの登録](#スラッシュコマンドの登録)
- [起動](#起動)
- [HTTPS 化・外部公開](#https-化外部公開)
- [使い方（概要）](#使い方概要)
- [コマンドリファレンス](#コマンドリファレンス)
- [OBS の設定](#obsの設定)
- [バージョン](#バージョン)
- [ディレクトリ構成](#ディレクトリ構成)
- [セキュリティ](#セキュリティ)
- [トラブルシューティング](#トラブルシューティング)
- [お問い合わせ](#お問い合わせ)

### ドキュメント索引（`docs/`）

| ドキュメント | 内容 |
|---|---|
| [docs/environment.md](docs/environment.md) | 環境変数の一覧・必須項目 |
| [docs/ALLOWED_ORIGINS.md](docs/ALLOWED_ORIGINS.md) | Socket.io CORS・本番運用 |
| [docs/message-format.md](docs/message-format.md) | メタデータ書式・装飾・セッション上限 |
| [docs/https-publication.md](docs/https-publication.md) | HTTPS 化・リバプロ例 |
| [docs/security.md](docs/security.md) | セキュリティ設計の要点 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | よくある不具合 |
| [docs/directory-structure.md](docs/directory-structure.md) | ソースツリー |

---

## 機能一覧

- Discord の指定チャンネルのメッセージをリアルタイムで OBS へ配信
- ニコニコ動画風の横スクロールコメント（速度は文字数に応じて変化）
- AES-256-GCM による転送の暗号化
- カスタム絵文字のインライン表示
- 改行・AA 対応、`? … ?` メタデータによる色・サイズ・位置指定
- 上下固定表示モード（`public/script.js` のタイマーに依存）
- セッションごとの同時表示上限（1〜99999）と `/setlimit` による変更
- グローバル / サーバー別ブラックリスト
- サーバーごとの設定分離（SQLite + ギルド単位の暗号化設定）
- `/status` による CPU・メモリ・バージョン・セッション情報の表示
- 一覧系コマンドは **10 件／ページ**、**◀ ▶** ボタンと **`page` オプション**でページ移動

---

## Discord への招待

招待 URL → **[https://discord.com/oauth2/authorize?client_id=1484621724015399032]**

## 公開 BOT でのプライバシー・利用規約

- プライバシーポリシー → **[https://d2obs.dtt.f5.si/privacy]**
- 利用規約 → **[https://d2obs.dtt.f5.si/terms]**

---

## 動作環境

| 項目 | 要件 |
|---|---|
| Node.js | v22.0.0 以上（`package.json` の `engines` 参照） |
| OS | Windows / macOS / Linux |
| Discord | Bot アカウント |
| OBS Studio | ブラウザソース対応版 |

---

## インストール手順

### 1. リポジトリの取得

```bash
git clone https://github.com/DTT-JP/Discord-to-OBS-nicoChat.git
cd Discord-to-OBS-nicoChat
```

（フォルダ名は clone 先に合わせてください。`package.json` の `name` は `discord-obs-overlay` です。）

### 2. 依存パッケージ

```bash
npm install
```

### 3. 環境変数

```bash
cp .env.example .env
```

`.env` を編集します。**必須項目は [docs/environment.md](docs/environment.md) と `index.js` の検証**を正とします（`DISCORD_TOKEN` `CLIENT_ID` `PORT` `HOST` `MASTER_KEY` など）。

---

## 環境変数

サマリーは **[docs/environment.md](docs/environment.md)** を参照してください。`.env.example` にコメント付きテンプレートがあります。

本番では **`NODE_ENV=production`** に加え、[docs/ALLOWED_ORIGINS.md](docs/ALLOWED_ORIGINS.md) の **`ALLOWED_ORIGINS`** / **`ALLOW_NULL_ORIGIN`** 設定が必須になります。

---

## Discord Developer Portal の設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリを作成し、**Application ID** を `CLIENT_ID` に設定。
2. **Bot** からトークンを取得し `DISCORD_TOKEN` に設定。
3. **Privileged Gateway Intents**: **SERVER MEMBERS INTENT** と **MESSAGE CONTENT INTENT** を有効化。
4. **OAuth2 > URL Generator**: `bot` と `applications.commands` を選び、必要な権限を付与してサーバーに招待。

---

## スラッシュコマンドの登録

```bash
npm run deploy-commands
```

グローバル登録のため、反映まで最大約 1 時間かかる場合があります。コードやサブコマンドを変えたら **必ず再実行**してください（未登録のコマンドはクライアントに出ません）。ギルドのみに試す場合は `deploy-commands-guild.js` を利用できます。

---

## 起動

```bash
npm start
# 開発時
npm run dev
```

ログ例（内容は環境により多少異なります）:

```
[init] SQLite セッション状態: pending_auth=… active_sessions=…
[init] コマンドロード: /auth
…
[init] HTTP/Socket.io サーバー起動: http://…
[ready] BotName#0000 としてログインしました
```

---

## HTTPS 化・外部公開

**[docs/https-publication.md](docs/https-publication.md)** を参照してください（Cloudflare Tunnel・nginx 例）。

---

## 使い方（概要）

### 初回セットアップ（権限まわり）

1. **サーバーオーナーまたは管理者（Administrator）** が **`/config`** で次を行います。
   - だれが **`/setup`** を触れるか: `add_setup_role` / `add_setup_user` など（一覧は `setup_role_list` / `setup_user_list`）。
   - だれが **`/blacklist`**（サーバー別 BL・照会設定）を触れるか: `ctrl_blacklist_role` / `ctrl_blacklist_user` など（一覧は `ctrl_blacklist_role_list` / `ctrl_blacklist_user_list`）。
2. オーナー・管理者または `/config` で許可された担当が **`/setup`** で次を行います。
   - だれが **`/start`** できるか: `allow_start_role` / `allow_start_user` など。
   - 拒否チャンネル（`/start` で指定禁止）の追加・一覧など。
3. **`/blacklist`**（設定の詳細・`/my-status` の可否など）は [コマンドリファレンス](#コマンドリファレンス) を参照。

ユーザー指定は **`user`（@メンション）** と **`user_id`（17〜20 桁）** の **どちらか一方** で指定できます。

### OBS 配信の流れ

1. **`/start channel:#チャンネル [limit:数値]`**（**サーバー内**。許可ロール／ユーザー、またはオーナー・管理者）  
   → **DM** に **「OBS用URLを開く」リンクボタン** と **コピー用のコードブロック（URL 1 行）** が届きます。
2. OBS のブラウザソースにその URL を貼る → **6 桁の認証コード**が表示されます。
3. **`/auth code:XXXXXX`** を **`/start` と同じサーバーのテキストチャンネル**で実行（**DM 不可**）。  
   オーバーレイ画面にも同旨の案内があります。

メッセージの色・位置・装飾の詳細は **[docs/message-format.md](docs/message-format.md)** を参照してください。

### セッション終了

ブラウザソースを閉じる・再読み込み・OBS 終了などで WebSocket が切れるとセッションが終了します。再度 **`/start`** から行います。

---

## コマンドリファレンス

### 一般（グローバル BL 対象外に限り実行可）

| コマンド | 説明 |
|---|---|
| `/help` | ヘルプ表示 |
| `/status` | CPU・メモリ・バージョン・自分のセッション状況 |
| `/my-status` | 自分の BL 照会（サーバー設定で有効な場合） |

### `/start` 許可ユーザーもしくはサーバーオーナー・管理者

| コマンド | 説明 |
|---|---|
| `/start` | セッション開始。DM に URL（リンクボタン＋コピー用ブロック） |
| `/auth` | **同じサーバー内**で 6 桁コード入力（試行制限あり・**DM 不可**） |
| `/setlimit` | 配信中の同時表示上限を変更 |
| `/secret` | セッションエフェクト（`commands/secret.js`） |

### サーバーオーナー・管理者のみ（`/config`）

| コマンド | 説明 |
|---|---|
| `/config` | `/setup` 実行許可、`/blacklist` **操作**許可の追加・削除。一覧サブコマンドは **10 件／ページ**・`page`・◀▶ |

### サーバーオーナー・管理者、または `/config` で許可されたユーザー（`/setup`）

| コマンド | 説明 |
|---|---|
| `/setup` | 拒否チャンネル、`/start` 許可ロール／ユーザーの追加・削除、`overview`、各種 `_list`（ページング同上） |

### サーバーオーナー・管理者、または `/config` の `ctrl_blacklist_*` で許可（`/blacklist`）

| コマンド | 説明 |
|---|---|
| `/blacklist add` など | サーバー別ローカル BL の追加・削除・**ページ付き**一覧 |
| `/blacklist config` | `/my-status` 照会の可否・異議申し立て URL |
| `/blacklist config_show` | 上記の現在値 |

`add` の期限は **`duration_value`**（数値または無制限時は `infinity`）と **`duration_unit`**（分〜年、無制限時は `infinity`）の **組み合わせ**で指定します（詳細は実装またはエラーメッセージ参照）。

### 製作者専用（`.env` の `BOT_OWNER_ID`）

| コマンド | 説明 |
|---|---|
| `/global_blacklist` | グローバル BL。`list` も **ページ付き**。`add` の期限指定は `/blacklist add` と同様の `duration_value` / `duration_unit` |

---

## OBS の設定

1. ソースの「+」→ **ブラウザ**
2. **URL** — `/start` で DM に届いた URL（リンクを開くか、コードブロックからコピー）
3. **幅・高さ** — 配信解像度に合わせる（例: 1920×1080）
4. **カスタム CSS** — 空のまま  
5. **ページが表示されなくなったときにブラウザをシャットダウン** — チェックを外す  

背景は HTML 側で透明です。詳細は従来どおり OBS の挙動に依存します。

---

## バージョン

`utils/version.js` の `VERSION` を変更し、Bot を再起動すると `/status` 等に反映されます。

---

## ディレクトリ構成

**[docs/directory-structure.md](docs/directory-structure.md)** を参照してください。

---

## セキュリティ

概要は **[docs/security.md](docs/security.md)**、CORS は **[docs/ALLOWED_ORIGINS.md](docs/ALLOWED_ORIGINS.md)** を参照してください。

---

## トラブルシューティング

**[docs/troubleshooting.md](docs/troubleshooting.md)** を参照してください。

---

## お問い合わせ

本リポジトリの Issue からお願いします。
