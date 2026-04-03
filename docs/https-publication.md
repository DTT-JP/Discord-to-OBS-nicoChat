# HTTPS化・外部公開

このドキュメントは**セルフホスト時のみ**必要です。  
公開BOTを使う場合は設定不要です。

OBS が別PCにある場合や、外部ネットワーク経由で使う場合は HTTPS 公開を推奨します。  
設定後は `.env` の `PUBLIC_URL` を更新し、Bot を再起動してください。

本番運用では `NODE_ENV=production` と `ALLOWED_ORIGINS` 設定を必ず確認してください。

## 方法A: Cloudflare Tunnel（手軽）

ドメインなしで短時間に公開したい場合に向いています。

```bash
# インストール
winget install Cloudflare.cloudflared   # Windows
brew install cloudflared                # macOS

# ローカル3000番を公開
cloudflared tunnel --url http://localhost:3000
```

出力される URL（`https://xxxx.trycloudflare.com`）を `PUBLIC_URL` に設定します。

```env
PUBLIC_URL=https://xxxxxxxx.trycloudflare.com
```

一時トンネルは再起動のたびにURLが変わります。固定URLが必要な場合は Cloudflare Tunnel の永続構成を使ってください。  
[Cloudflare公式ドキュメント](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)

## 方法B: nginx リバースプロキシ（独自ドメイン）

独自ドメイン運用では、nginx で HTTPS 終端し Bot へ転送します。

```nginx
server {
    listen 443 ssl;
    server_name overlay.example.com;

    ssl_certificate     /etc/letsencrypt/live/overlay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/overlay.example.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;

        # Socket.io(WebSocket)に必要
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`.env` 例:

```env
PUBLIC_URL=https://overlay.example.com
```
