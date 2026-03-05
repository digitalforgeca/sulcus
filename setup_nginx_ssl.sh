#!/bin/bash
set -euo pipefail

DOMAIN="sulcus.dforge.ca"
EMAIL="ops@dforge.ca"

# Install Nginx + Certbot
sudo apt-get update -q
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  nginx certbot python3-certbot-nginx openssl

# Stop Nginx so certbot can bind :80 standalone
sudo systemctl stop nginx || true

sudo certbot certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --email "${EMAIL}" \
  --domains "${DOMAIN}" \
  --key-type ecdsa \
  --elliptic-curve secp384r1

# DH params (once)
[ ! -f /etc/ssl/dhparam.pem ] && sudo openssl dhparam -out /etc/ssl/dhparam.pem 2048

# Deploy config
cat << 'EOF' | sudo tee /etc/nginx/sites-available/sulcus.dforge.ca
upstream nextjs_backend    { server 127.0.0.1:8080; keepalive 32; }
upstream rust_api_backend  { server 127.0.0.1:3000; keepalive 32; }

server {
    listen 80; listen [::]:80;
    server_name sulcus.dforge.ca;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files $uri =404;
    }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl; listen [::]:443 ssl;
    http2 on;
    server_name sulcus.dforge.ca;

    ssl_certificate     /etc/letsencrypt/live/sulcus.dforge.ca/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sulcus.dforge.ca/privkey.pem;

    ssl_protocols             TLSv1.2 TLSv1.3;
    ssl_ciphers               'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305';
    ssl_prefer_server_ciphers on;
    ssl_dhparam               /etc/ssl/dhparam.pem;
    ssl_ecdh_curve            secp384r1;
    ssl_session_cache         shared:SSL:10m;
    ssl_session_timeout       1d;
    ssl_session_tickets       off;

    ssl_stapling        on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/sulcus.dforge.ca/chain.pem;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options           "DENY"          always;
    add_header X-Content-Type-Options    "nosniff"       always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;

    server_tokens off;

    location /api/ {
        proxy_pass            http://rust_api_backend;
        proxy_set_header      Host              $host;
        proxy_set_header      X-Real-IP         $remote_addr;
        proxy_set_header      X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header      X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass            http://nextjs_backend;
        proxy_set_header      Host              $host;
        proxy_set_header      X-Real-IP         $remote_addr;
        proxy_set_header      X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header      X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/sulcus.dforge.ca /etc/nginx/sites-enabled/sulcus.dforge.ca
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t && sudo systemctl enable nginx && sudo systemctl start nginx

echo "0 3 * * * root certbot renew --quiet --post-hook 'nginx -s reload'" | sudo tee /etc/cron.d/certbot-renew
