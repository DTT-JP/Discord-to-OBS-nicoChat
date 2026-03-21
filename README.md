# Discord OBS Overlay — ニコニコ風リアルタイムコメント配信Bot

Discordの指定チャンネルに投稿されたメッセージを、AES-256-GCM暗号化経由でOBSのブラウザソースへリアルタイム配信するBotです。コメントはニコニコ動画風に画面を横断して流れます。

---

## 目次

- [機能一覧](#機能一覧)
- [Discordへの招待](#Discordへの招待)
- [動作環境](#動作環境)
- [インストール手順](#インストール手順)
- [環境変数の設定](#環境変数の設定)
- [Discord Developer Portal の設定](#discord-developer-portal-の設定)
- [スラッシュコマンドの登録](#スラッシュコマンドの登録)
- [起動](#起動)
- [HTTPS化・外部公開](#https化外部公開)
- [使い方](#使い方)
  - [初回セットアップ（サーバーオーナー）](#初回セットアップサーバーオーナー)
  - [OBS配信の開始フロー](#obs配信の開始フロー)
  - [コメント装飾コマンド](#コメント装飾コマンド)
  - [セッション管理](#セッション管理)
- [コマンドリファレンス](#コマンドリファレンス)
- [OBSの設定方法](#obsの設定方法)
- [ディレクトリ構成](#ディレクトリ構成)
- [セキュリティについて](#セキュリティについて)
- [トラブルシューティング](#トラブルシューティング)
- [お問い合わせ](#お問い合わせ) 

---

## 機能一覧

- Discordの指定チャンネルのメッセージをリアルタイムでOBSへ配信
- ニコニコ動画風の横スクロールコメント表示
- AES-256-GCM暗号化による安全な通信
- カスタム絵文字・スタンプのインライン画像表示
- 改行・AA（アスキーアート）対応
- Discord書式（太字・斜体・下線・取り消し線・見出し）の反映
- ニコニコ風カラー・位置コマンド対応
- 上下固定表示モード（中央配置・時間後に消去）
- セッションごとの同時表示上限設定・配信中のリアルタイム変更
- 複数サーバー・複数ユーザーへの独立した対応
- ローカル運用・HTTPS外部公開の両対応（`PUBLIC_URL` による切り替え）
- CPU・メモリ使用率のリアルタイム監視

---

## Discordへの招待

招待URLはこちら → **[https://discord.com/oauth2/authorize?client_id=1484621724015399032]**

## 公開BOTでは以下のプライバシーポリシーおよび利用規約が適用されます

プライバシーポリシー　→ **[https://d2obs.dtt.f5.si/privacy]**

利用規約　→ **[https://d2obs.dtt.f5.si/terms]**

---

## 動作環境

| 項目 | 要件 |
|---|---|
| Node.js | v22.0.0 以上 |
| OS | Windows / macOS / Linux |
| Discord | Bot アカウント（後述） |
| OBS Studio | ブラウザソース対応バージョン |

---

## インストール手順

### 1. リポジトリのクローン

公開リポジトリのURLはこちら → **[ここに公開URLを記入]**

```bash
git clone [公開URL]
cd discord-obs-overlay
```

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. 環境変数ファイルの作成

```bash
cp .env.example .env
```

`.env` をテキストエディタで開き、各項目を設定します（次章参照）。

---

## 環境変数の設定

`.env` ファイルを編集します。全項目にコメントで説明が記載されています。

```env
# ═══════════════════════════════════════════════
# Discord OBS Overlay — 環境変数設定ファイル
# ═══════════════════════════════════════════════

# ── Discord 認証情報 ──────────────────────────────
DISCORD_TOKEN=ここにBotトークンを入力
CLIENT_ID=ここにアプリケーションIDを入力
# GUILD_ID=ここにギルドIDを入力  ← 通常不要

# ── サーバー設定 ──────────────────────────────────
PORT=3000
HOST=localhost

# 公開URL（HTTPS化する場合のみ設定）
# 未設定の場合は http://HOST:PORT が使われる
PUBLIC_URL=

# ── コメント表示設定 ──────────────────────────────
MAX_COMMENTS=30

# ── 認証設定 ──────────────────────────────────────
CODE_EXPIRE_MINUTES=10
```

### 各項目の説明

| 項目 | 必須 | 説明 |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | BotのトークンをDeveloper Portalから取得 |
| `CLIENT_ID` | ✅ | アプリケーションID（General Information > Application ID） |
| `GUILD_ID` | — | 通常不要。開発時にコマンドを即時反映したい場合のみ設定 |
| `PORT` | ✅ | Expressサーバーのポート番号（デフォルト: 3000） |
| `HOST` | ✅ | URLの生成に使うホスト名（`PUBLIC_URL` 設定時は参照されない） |
| `PUBLIC_URL` | — | HTTPS公開時に設定。設定すると `http://HOST:PORT` より優先される |
| `MAX_COMMENTS` | ✅ | 同時表示コメントのデフォルト上限数（デフォルト: 30） |
| `CODE_EXPIRE_MINUTES` | ✅ | 認証コードの有効期限（分、デフォルト: 10） |

### HOST と PUBLIC_URL の使い分け

| 運用方法 | 設定 |
|---|---|
| 自分のPCのOBSのみで使う | `HOST=localhost`、`PUBLIC_URL` は空 |
| LAN内の別PCのOBSで使う | `HOST=192.168.1.10`（このPCのIP）、`PUBLIC_URL` は空 |
| インターネット越しにHTTPSで使う | `PUBLIC_URL=https://overlay.example.com` を設定 |

---

## Discord Developer Portal の設定

### 1. アプリケーションの作成

1. [Discord Developer Portal](https://discord.com/developers/applications) を開く
2. **New Application** をクリックしてアプリを作成
3. **General Information** ページの **Application ID** をコピーして `.env` の `CLIENT_ID` に貼り付ける

### 2. Bot の作成とトークン取得

1. 左メニューの **Bot** を開く
2. **Add Bot** をクリック
3. **Token** セクションで **Reset Token** → トークンをコピーして `.env` の `DISCORD_TOKEN` に貼り付ける
4. **Privileged Gateway Intents** セクションで以下を **ON** にする

| Intent | 用途 |
|---|---|
| **SERVER MEMBERS INTENT** | メンバーの表示名・ロール取得 |
| **MESSAGE CONTENT INTENT** | メッセージ本文の読み取り |

### 3. BotをサーバーへInvite

1. 左メニューの **OAuth2 > URL Generator** を開く
2. **SCOPES** で `bot` と `applications.commands` を選択
3. **BOT PERMISSIONS** で以下を選択

| 権限 | 用途 |
|---|---|
| Send Messages | コマンド結果の送信 |
| Send Messages in Threads | スレッド内での返信 |
| Read Message History | メッセージ履歴の読み取り |
| View Channels | チャンネルの閲覧 |

4. 生成されたURLをブラウザで開き、対象サーバーにBotを追加する

---

## スラッシュコマンドの登録

**Botを起動する前に一度だけ実行**します。コマンドの追加・変更時も再実行が必要です。

```bash
npm run deploy-commands
```

> グローバルコマンドとして登録されます。反映まで最大1時間かかる場合があります。

---

## 起動

```bash
# 通常起動
npm start

# ファイル変更を自動検知して再起動（開発時）
npm run dev
```

起動成功時のログ例：

```
[init] コマンドロード: /auth
[init] コマンドロード: /help
[init] コマンドロード: /setup
[init] コマンドロード: /setlimit
[init] コマンドロード: /start
[init] コマンドロード: /status
[init] HTTP/Socket.io サーバー起動: http://localhost:3000
[ready] BotName#0000 としてログインしました
```

---

## HTTPS化・外部公開

OBSが別のPCにある場合や、インターネット越しに利用したい場合はHTTPS化が推奨されます。
設定後は `.env` の `PUBLIC_URL` にそのURLを記入し、Botを再起動してください。

### 方法A: Cloudflare Tunnel（無料・ドメイン不要・最も簡単）

```bash
# インストール
winget install Cloudflare.cloudflared   # Windows
brew install cloudflared                # macOS

# 一時トンネルを作成（ドメインが自動発行される）
cloudflared tunnel --url http://localhost:3000

# 出力例:
# https://xxxxxxxx.trycloudflare.com  ← これを PUBLIC_URL に設定する
```

`.env` の設定：

```env
PUBLIC_URL=https://xxxxxxxx.trycloudflare.com
```

> 一時トンネルはプロセスを再起動するたびにURLが変わります。固定URLにするには
> [Cloudflare Tunnel の永続設定](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) を参照してください。

### 方法B: nginx リバースプロキシ（独自ドメインあり）

```nginx
server {
    listen 443 ssl;
    server_name overlay.example.com;

    ssl_certificate     /etc/letsencrypt/live/overlay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/overlay.example.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;

        # Socket.io の WebSocket に必須
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`.env` の設定：

```env
PUBLIC_URL=https://overlay.example.com
```

### PUBLIC_URL 設定時の動作

`PUBLIC_URL` を設定すると、`/start` コマンドでDMに送られるURLが以下のように変わります。

```
# 未設定時（ローカル）
http://localhost:3000/?token=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# 設定時（HTTPS）
https://overlay.example.com/?token=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

## 使い方

### 初回セットアップ（サーバーオーナー）

Botを導入したサーバーで最初に `/setup` コマンドを使用し、`/start` コマンドを実行できるユーザー・ロールを設定します。

```
/setup allow_role role:@配信者
/setup allow_user user:@ユーザー名
```

設定を確認するには：

```
/setup list
```

---

### OBS配信の開始フロー

```
① /start channel:#チャンネル名
```
→ BotからDMにOBSブラウザソース用のURLが届きます

```
② OBS Studio でブラウザソースを追加
```
→ URLを貼り付けてソースを追加します（設定は後述）
→ 画面に6桁の認証コードが表示されます

```
③ /auth [6桁のコード]
```
→ Discordで認証コードを入力します
→ 「認証完了」と表示されればOKです
→ OBSの画面から認証コードが消え、コメント配信が開始されます

---

### コメント装飾コマンド

メッセージの先頭に記述します。色・位置・見出しの組み合わせは**順不同**です。

#### カラーコマンド

| コマンド | 色 |
|---|---|
| `[赤]` または `[red]` | 赤 (#FF4040) |
| `[青]` または `[blue]` | 青 (#4488FF) |
| `[黄]` または `[yellow]` | 黄 (#FFE133) |
| `[緑]` または `[green]` | 緑 (#33DD44) |
| `[白]` または `[white]` | 白 (#FFFFFF) |

#### 位置コマンド

| コマンド | 効果 |
|---|---|
| `[上]` / `[ue]` / `[top]` | 画面上部に固定表示（8秒後に消去） |
| `[下]` / `[sita]` / `[bottom]` | 画面下部に固定表示（8秒後に消去） |

> 位置コマンドなし → 画面を横断して流れます

#### 見出しコマンド（Discord書式）

| 書式 | サイズ | 備考 |
|---|---|---|
| `# テキスト` | 大（12vh） | H1見出し |
| `## テキスト` | 中（9vh） | H2見出し |
| `### テキスト` | 小（7vh） | H3見出し |
| `-# テキスト` | 極小（3vh） | 小文字表示 |

#### テキスト装飾（Discord書式）

| 書式 | 効果 |
|---|---|
| `**テキスト**` | 太字 |
| `*テキスト*` | 斜体 |
| `__テキスト__` | 下線 |
| `~~テキスト~~` | 取り消し線 |

#### 組み合わせ例

```
[赤][上] # お知らせ           → 赤色・大文字・画面上部に固定表示
[blue] **重要なメッセージ**   → 青色・太字・横スクロール
[下][緑] ありがとう！         → 緑色・画面下部に固定表示
# [赤] タイトル               → 見出しの後にカラーコマンドも有効
```

#### 改行・AA（アスキーアート）

Discordで通常通り改行（Shift+Enter）して送信すると、そのまま複数行で表示されます。行内のスペースも保持されるためAAの位置合わせが崩れません。

```
（´・ω・｀）
 / ̄ ̄ ̄\
```

---

### セッション管理

#### 同時表示上限の指定

`/start` コマンド実行時に上限を指定できます（1〜10000）。

```
/start channel:#チャンネル名 limit:100
```

未指定の場合は `.env` の `MAX_COMMENTS`（デフォルト: 30）が使われます。

#### 配信中の上限変更

セッションを停止せずにリアルタイムで上限を変更できます。

```
/setlimit limit:50
```

---

## コマンドリファレンス

| コマンド | 権限 | 説明 |
|---|---|---|
| `/setup allow_role role:@ロール` | サーバーオーナー | `/start` を許可するロールを追加 |
| `/setup remove_role role:@ロール` | サーバーオーナー | `/start` の許可ロールを削除 |
| `/setup allow_user user:@ユーザー` | サーバーオーナー | `/start` を許可するユーザーを追加 |
| `/setup remove_user user:@ユーザー` | サーバーオーナー | `/start` の許可ユーザーを削除 |
| `/setup list` | サーバーオーナー | 現在の許可リストを表示 |
| `/start channel:#ch [limit:数値]` | 許可済みユーザー | OBSオーバーレイのセッションを開始 |
| `/auth [6桁コード]` | 誰でも | OBSブラウザの認証コードを入力して接続を確立 |
| `/setlimit limit:数値` | セッション保持者 | 配信中のセッションの同時表示上限を変更（1〜99999） |
| `/status` | 誰でも | CPU・メモリ使用率と自分のセッション状況を表示 |
| `/help` | 誰でも | コマンド一覧と使い方を表示 |

---

## OBSの設定方法

1. OBS Studio を起動する
2. ソースの `+` ボタン → **ブラウザ** を選択
3. 以下のように設定する

| 項目 | 値 |
|---|---|
| URL | `/start` コマンドでDMに届いたURL |
| 幅 | 配信解像度の幅（例: `1920`） |
| 高さ | 配信解像度の高さ（例: `1080`） |
| カスタムCSS | （空白のまま） |
| ページが表示されなくなったときにブラウザをシャットダウン | チェックを外す |
| シーンがアクティブになったときにブラウザを更新 | 任意 |

4. **OK** をクリック
5. ブラウザソース上に認証コードが表示されるので、Discordで `/auth [コード]` を実行する

> **背景の透過について**  
> このオーバーレイは背景が透明（`transparent`）です。  
> OBSのブラウザソースはデフォルトで透過に対応しているため、クロマキーは不要です。

---

## ディレクトリ構成

```
discord-obs-overlay/
├── .env                    # 環境変数（要作成）
├── .env.example            # 環境変数テンプレート
├── package.json
├── index.js                # エントリーポイント・全体統合
├── deploy-commands.js      # スラッシュコマンド一括登録
├── database.js             # lowdb によるデータ管理
├── db.json                 # データベースファイル（自動生成）
├── discord/
│   └── parser.js           # メッセージパーサー
├── commands/
│   ├── setup.js            # /setup コマンド
│   ├── start.js            # /start コマンド（PUBLIC_URL対応）
│   ├── auth.js             # /auth コマンド
│   ├── setlimit.js         # /setlimit コマンド
│   ├── status.js           # /status コマンド
│   └── help.js             # /help コマンド
├── events/
│   ├── ready.js            # Bot起動時イベント
│   ├── interactionCreate.js # スラッシュコマンド受付
│   └── messageCreate.js    # メッセージ受信・配信
├── socket/
│   ├── server.js           # Express + Socket.io サーバー
│   └── manager.js          # セッション管理・鍵配布
├── public/
│   ├── index.html          # OBSブラウザ表示画面
│   └── script.js           # クライアントサイドJS
└── utils/
    ├── crypto.js           # AES-256-GCM 暗号化
    └── systemMonitor.js    # CPU・メモリ監視
```

---

## セキュリティについて

本Botは以下のセキュリティ機構を実装しています。

**トークン認証**  
`/start` 実行時にUUID v4のワンタイムトークンを発行します。トークンには有効期限（デフォルト10分）が設定されており、期限切れのものは自動削除されます。

**6桁コードによる本人確認**  
ブラウザ接続後に発行される6桁コードは、`/start` を実行したユーザーのDiscord IDと照合します。第三者が認証コードを知っていても、異なるDiscordアカウントからは認証できません。

**AES-256-GCM暗号化**  
認証完了後のメッセージは全てAES-256-GCM（認証付き暗号化）で暗号化されます。IVは毎回ランダム生成され、Auth Tagによる改ざん検知も行われます。

**セッションのスコープ分離**  
複数サーバーに導入した場合、各サーバーの設定（許可ロール・ユーザー）は完全に独立して管理されます。

---

## トラブルシューティング

### 認証コードが表示されない

- OBSのブラウザソースを右クリック → **更新** を試してください
- Node.jsコンソールに `[manager] 接続確立・コード生成` が出ているか確認してください
- `HOST` と `PORT`（または `PUBLIC_URL`）の設定がOBSからアクセス可能なアドレスになっているか確認してください

### `/start` を実行しても「権限がありません」と表示される

サーバーオーナーが `/setup allow_role` または `/setup allow_user` でそのユーザー・ロールを許可リストに追加する必要があります。

### Botが指定チャンネルを閲覧できないと言われる

Discordのチャンネル設定でBotロールに「チャンネルを見る」と「メッセージ履歴を読む」の権限を付与してください。

### コメントが流れない・表示されない

- `/auth` で認証が完了しているか確認してください（OBSの認証コード画面が消えているはずです）
- Node.jsコンソールに `[manager] auth_success 送信` が出ているか確認してください
- ブラウザの開発者ツール（F12）でエラーが出ていないか確認してください

### `deploy-commands` でエラーが出る

`.env` の `DISCORD_TOKEN` と `CLIENT_ID` が正しく設定されているか確認してください。Developer PortalのURLに `your_application_id_here` と表示されている場合は未設定です。

### HTTPS化したのにURLが `http://` になる

`.env` の `PUBLIC_URL` が正しく設定されているか確認してください。設定後はBotを再起動する必要があります。

```env
# 正しい例
PUBLIC_URL=https://overlay.example.com

# よくあるミス（末尾スラッシュは自動除去されるが念のため省略推奨）
PUBLIC_URL=https://overlay.example.com/
```

### プロセスを終了すると全セッションが切断される

仕様です。プロセス終了時にDBの全アクティブセッションを削除します。再起動後は `/start` からやり直してください。

---

## お問い合わせ

お問い合わせは本リポジトリのissueからおねがいします。
