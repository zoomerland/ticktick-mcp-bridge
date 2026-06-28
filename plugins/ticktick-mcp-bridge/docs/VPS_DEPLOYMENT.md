# Optional VPS Deployment

This optional guide is for a small single-user VPS deployment for ChatGPT Desktop / ChatGPT apps.

The marketplace plugin can still be used locally through Codex without any VPS. A VPS is only useful when you want ChatGPT or other remote clients to reach the same MCP server over HTTPS.

## Security Model

ChatGPT needs a reachable HTTPS MCP endpoint, for example:

```text
https://ticktick-mcp.example.com/mcp
```

Use three layers:

1. TLS certificate from Caddy or another reverse proxy.
2. `APP_SHARED_SECRET` bearer authentication on `/mcp`.
3. TickTick OAuth token storage on the VPS, owned by the service user.

Do not expose the Node HTTP server directly to the public internet without `APP_SHARED_SECRET`.

## Suggested Topology

```text
ChatGPT -> https://ticktick-mcp.example.com/mcp -> Caddy -> http://127.0.0.1:8787/mcp -> Node
```

Keep the Node server bound to loopback:

```text
BIND_HOST=127.0.0.1
PORT=8787
```

Caddy listens on ports `80` and `443`, obtains the certificate, and proxies to Node.

## Free VPS Notes

Good low-cost starting points:

- Google Cloud e2-micro Always Free, if you stay inside free-tier limits.
- A home server with Cloudflare Tunnel when a VPS is not available.

For Google Cloud, use Compute Engine with the Always Free `e2-micro` shape in one of the supported US regions:

- `us-west1`
- `us-central1`
- `us-east1`

Keep the disk inside the free standard persistent disk allowance and avoid premium disks, GPUs, extra static IPs, load balancers, or paid regions.

You still need a stable hostname. A real domain or stable subdomain is much easier than a temporary tunnel URL because the same URL must be configured in:

- `PUBLIC_BASE_URL`
- `TICKTICK_REDIRECT_URI`
- the TickTick developer app redirect URI
- ChatGPT connector MCP URL

## Environment

Create `.env` in the package directory:

```bash
cd /opt/ticktick-mcp-bridge/plugins/ticktick-mcp-bridge
cp .env.example .env
```

Use values like:

```text
PORT=8787
BIND_HOST=127.0.0.1
PUBLIC_BASE_URL=https://ticktick-mcp.example.com

TICKTICK_CLIENT_ID=your-client-id
TICKTICK_CLIENT_SECRET=your-client-secret
TICKTICK_REDIRECT_URI=https://ticktick-mcp.example.com/oauth/callback

APP_SHARED_SECRET=replace-with-a-long-random-secret
CHATGPT_OAUTH_CLIENT_ID=ticktick-mcp-chatgpt
CHATGPT_OAUTH_CLIENT_SECRET=replace-with-another-long-random-secret
CHATGPT_OAUTH_TOKEN_SECRET=replace-with-a-token-signing-secret
TICKTICK_AUTH_FILE=/var/lib/ticktick-mcp-bridge/auth.json
```

Generate a random secret:

```bash
openssl rand -base64 48
```

Register the exact `TICKTICK_REDIRECT_URI` in the TickTick developer app.

## Install

Example Ubuntu setup:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

Clone the repository:

```bash
sudo mkdir -p /opt/ticktick-mcp-bridge
sudo chown "$USER":"$USER" /opt/ticktick-mcp-bridge
git clone https://github.com/zoomerland/ticktick-mcp-bridge.git /opt/ticktick-mcp-bridge
cd /opt/ticktick-mcp-bridge/plugins/ticktick-mcp-bridge
npm run check
npm test
```

The project currently has no runtime npm dependencies, so `npm install` is optional unless dependencies are added later.

## Systemd Service

Create a service user and auth directory:

```bash
sudo useradd --system --home /var/lib/ticktick-mcp-bridge --shell /usr/sbin/nologin ticktick-mcp || true
sudo mkdir -p /var/lib/ticktick-mcp-bridge
sudo chown ticktick-mcp:ticktick-mcp /var/lib/ticktick-mcp-bridge
sudo chown -R ticktick-mcp:ticktick-mcp /opt/ticktick-mcp-bridge
```

Create `/etc/systemd/system/ticktick-mcp-bridge.service`:

```ini
[Unit]
Description=TickTick MCP Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ticktick-mcp
Group=ticktick-mcp
WorkingDirectory=/opt/ticktick-mcp-bridge/plugins/ticktick-mcp-bridge
EnvironmentFile=/opt/ticktick-mcp-bridge/plugins/ticktick-mcp-bridge/.env
ExecStart=/usr/bin/node src/server.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/ticktick-mcp-bridge

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ticktick-mcp-bridge
sudo journalctl -u ticktick-mcp-bridge -f
```

## Caddy Reverse Proxy

Install Caddy, then create a site:

```caddyfile
ticktick-mcp.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

Check:

```bash
curl https://ticktick-mcp.example.com/health
```

## Authorize TickTick

Open this URL in a browser:

```text
https://ticktick-mcp.example.com/oauth/start
```

After the callback succeeds, verify:

```bash
curl https://ticktick-mcp.example.com/health
```

## Test MCP

Use bearer auth:

```bash
SMOKE_BASE_URL=https://ticktick-mcp.example.com/mcp \
SMOKE_BEARER_TOKEN=replace-with-the-same-secret \
npm run smoke
```

In ChatGPT Developer Mode, create a connector/app with:

```text
Connector URL: https://ticktick-mcp.example.com/mcp
Authentication: OAuth
Authorization URL: https://ticktick-mcp.example.com/oauth/authorize
Token URL: https://ticktick-mcp.example.com/oauth/token
Client ID: the CHATGPT_OAUTH_CLIENT_ID value
Client secret: the CHATGPT_OAUTH_CLIENT_SECRET value
Scopes: ticktick:read ticktick:write
```

Then scan tools and refresh metadata after each deploy that changes tools.

## Update

```bash
cd /opt/ticktick-mcp-bridge
git pull --ff-only
cd plugins/ticktick-mcp-bridge
npm run check
npm test
sudo systemctl restart ticktick-mcp-bridge
```
