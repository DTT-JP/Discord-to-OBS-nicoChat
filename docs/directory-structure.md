# ディレクトリ構成（主要ファイル）

```
discord-obs-overlay/
├── .env                      # 環境変数（要作成、gitignore）
├── .env.example
├── package.json
├── index.js                  # エントリーポイント
├── deploy-commands.js
├── deploy-commands-guild.js
├── database.js               # SQLite（better-sqlite3）・マイグレーション
├── app.db                    # DB ファイル（自動生成、gitignore 推奨）
├── discord/
│   └── parser.js             # メッセージパーサー
├── commands/
│   ├── auth.js
│   ├── blacklist.js          # サーバー別ローカル BL・照会設定
│   ├── config.js             # /setup・/blacklist 操作の実行許可管理
│   ├── global_blacklist.js
│   ├── help.js
│   ├── my-status.js
│   ├── session.js
│   ├── setup.js              # 拒否チャンネル、/start 許可など
│   ├── start.js              # セッション開始・DM に URL
│   └── status.js
├── events/
│   ├── ready.js
│   ├── interactionCreate.js  # スラッシュ＋一覧ページのボタン
│   └── messageCreate.js
├── socket/
│   ├── server.js             # Express + Socket.io + helmet
│   └── manager.js
├── public/
│   ├── index.html
│   └── script.js
├── utils/
│   ├── blacklistDuration.js  # BL 追加時の期限パース
│   ├── crypto.js
│   ├── corsPolicy.js
│   ├── deriveGuildKey.js
│   ├── logSafe.js
│   ├── moderation.js         # isAdminOrOwner、parseTargetUser 等
│   ├── paginatedList.js      # 一覧 10 件/ページ・◀▶
│   ├── systemMonitor.js
│   └── version.js
└── docs/
    ├── ALLOWED_ORIGINS.md
    ├── environment.md
    ├── https-publication.md
    ├── message-format.md
    ├── security.md
    └── troubleshooting.md
```

※ スラッシュコマンドは `deploy-commands.js` が `commands/*.js` を読み込んで登録します。  
※ セキュリティ上の理由で、この一覧には内部運用用の一部コマンドを含めていません。
