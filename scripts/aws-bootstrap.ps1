param(
  [string]$EnvPath = (Join-Path $PSScriptRoot "..\.env")
)

$ErrorActionPreference = "Stop"
$envContent = Get-Content -Raw -LiteralPath $EnvPath
$envBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($envContent))

$userData = @"
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
install -d -m 0755 /opt/followthrough
git clone --depth 1 https://github.com/AdarshSingh-ASR/FollowThrough.git /opt/followthrough
cd /opt/followthrough
npm ci --omit=dev
echo '$envBase64' | base64 -d > /opt/followthrough/.env
chmod 600 /opt/followthrough/.env
cat > /etc/systemd/system/followthrough.service <<'UNIT'
[Unit]
Description=FollowThrough Slack bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/followthrough
ExecStart=/usr/bin/node src/app.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now followthrough
"@

[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($userData))
