# ディレクトリ構成（抜粋）

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
│   ├── blacklist.js          # サーバー別ローカル BL
│   ├── config.js             # /start 許可・/setup 実行許可の管理
│   ├── global_blacklist.js
│   ├── help.js
│   ├── my-status.js
│   ├── secret.js
│   ├── setlimit.js
│   ├── setup.js              # deny_channel / blacklist_status 等
│   └── status.js
├── events/
│   ├── ready.js
│   ├── interactionCreate.js
│   └── messageCreate.js
├── socket/
│   ├── server.js             # Express + Socket.io + helmet
│   └── manager.js
├── public/
│   ├── index.html
│   └── script.js
├── utils/
│   ├── crypto.js
│   ├── corsPolicy.js
│   ├── deriveGuildKey.js
│   ├── logSafe.js
│   ├── moderation.js
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

※ スラッシュコマンドは `deploy-commands.js` で登録されます。定義ファイルは `commands/*.js` を参照してください。
