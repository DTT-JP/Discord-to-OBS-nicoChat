# HTTPS 化・外部公開

OBS が別の PC にある場合や、インターネット越しに利用したい場合は HTTPS 化が推奨されます。  
設定後は `.env` の `PUBLIC_URL` にその URL を記入し、Bot を再起動してください。

本番では `NODE_ENV=production` とあわせて `docs/ALLOWED_ORIGINS.md` の CORS 設定を確認してください。

## 方法A: Cloudflare Tunnel（無料・ドメイン不要・最も簡単）

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

一時トンネルはプロセスを再起動するたびに URL が変わります。固定 URL にするには [Cloudflare Tunnel の永続設定](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) を参照してください。

## 方法B: nginx リバースプロキシ（独自ドメインあり）

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
