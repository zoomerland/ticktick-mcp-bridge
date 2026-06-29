# Optional VPS Deployment

This optional guide is for a small single-user VPS deployment for ChatGPT
Desktop, ChatGPT apps, or another remote MCP client.

The marketplace plugin still works locally through Codex without any VPS. A VPS
is useful only when you want a stable HTTPS MCP endpoint outside your computer.
The helper below does not replace the local Codex stdio plugin configuration;
it prepares a remote HTTP MCP endpoint and prints the values needed for
ChatGPT or another remote MCP client.

## Security Model

This deployment is intended for one person and one TickTick account. The server
belongs to that person. No shared TickTick token, OpenAI token, Telegram token,
or repository secret is included in this project.

The helper writes secrets only to the private VPS `.env` file and prints the
generated ChatGPT connector values once so the owner can copy them into
ChatGPT. Do not commit those values.

Use four layers:

1. SSH access controlled by the VPS owner.
2. TLS certificate from Caddy, Nginx, or an existing reverse proxy.
3. ChatGPT OAuth for `/mcp`.
4. TickTick OAuth token storage on the VPS, under
   `/var/lib/ticktick-mcp-bridge/auth.json`.

The Node service remains bound to loopback:

```text
BIND_HOST=127.0.0.1
PORT=8787
```

The reverse proxy listens on public `80` and `443` and proxies to Node:

```text
ChatGPT -> https://ticktick-mcp.example.com/mcp -> reverse proxy -> http://127.0.0.1:8787/mcp -> Node
```

Do not expose the Node HTTP server directly to the internet.

## Prerequisites

You need:

- an Ubuntu/Debian VPS with `sudo` access;
- SSH host, username, and preferably an SSH key;
- ports `80` and `443` open in the VPS firewall/cloud firewall;
- a stable DNS name pointing at the VPS;
- a TickTick developer app client id and client secret.

The DNS name must be used consistently in:

- `PUBLIC_BASE_URL`;
- `TICKTICK_REDIRECT_URI`;
- the TickTick developer app redirect URL;
- the ChatGPT connector settings.

## Automated Setup From Windows

Run this from the repository package directory on your computer:

```powershell
cd plugins\ticktick-mcp-bridge

.\scripts\deploy-vps.ps1 `
  -SshHost "YOUR_SERVER_IP_OR_HOST" `
  -SshUser "YOUR_SSH_USER" `
  -SshKeyPath "$env:USERPROFILE\.ssh\id_ed25519" `
  -Domain "ticktick-mcp.example.com" `
  -TickTickClientId "YOUR_TICKTICK_CLIENT_ID"
```

If you omit `-SshKeyPath`, OpenSSH may prompt for the SSH password if password
login is enabled on the server. The script does not store the SSH password.

The script prompts for the TickTick client secret as a secure input. It then:

- installs Git, curl, certificates, Node.js 22, and the chosen reverse proxy
  when needed;
- clones or updates this repository on the VPS;
- generates `APP_SHARED_SECRET`, `CHATGPT_OAUTH_CLIENT_SECRET`, and
  `CHATGPT_OAUTH_TOKEN_SECRET` if you did not provide them;
- writes the VPS `.env` file;
- installs a locked-down systemd service;
- configures a reverse proxy for the domain when possible;
- runs `npm run check` and `npm test` on the VPS;
- restarts the service;
- prints the exact TickTick and ChatGPT settings to copy.

It does not store your SSH password and does not commit any generated secret.
The local Codex marketplace plugin continues to use its local stdio server.

Optional parameters:

```powershell
.\scripts\deploy-vps.ps1 `
  -SshHost "YOUR_SERVER_IP_OR_HOST" `
  -SshUser "YOUR_SSH_USER" `
  -SshPort 22 `
  -Domain "ticktick-mcp.example.com" `
  -TickTickClientId "YOUR_TICKTICK_CLIENT_ID" `
  -RepoUrl "https://github.com/zoomerland/ticktick-mcp-bridge.git" `
  -Branch "main" `
  -RemoteRoot "/opt/ticktick-mcp-bridge" `
  -ServiceUser "ticktick-mcp" `
  -ReverseProxy auto
```

Use `-SkipPackageInstall` when the VPS already has Git, Node.js, and the chosen
reverse proxy.

Reverse proxy modes:

- `-ReverseProxy auto` detects an active or installed Caddy/Nginx. If neither
  exists, it installs and configures Caddy.
- `-ReverseProxy caddy` installs Caddy when needed and writes a separate
  `/etc/caddy/conf.d/ticktick-mcp-bridge.caddy` site. The helper adds an import
  line to `/etc/caddy/Caddyfile` instead of replacing existing sites.
- `-ReverseProxy nginx` installs Nginx when needed and writes a separate
  `/etc/nginx/sites-available/ticktick-mcp-bridge.conf` site. It runs
  `nginx -t` before reload. Use `-StagingSelfSigned` for a disposable
  self-signed certificate, or pass existing trusted certificate paths with
  `-NginxSslCertificatePath` and `-NginxSslCertificateKeyPath`.
- `-ReverseProxy manual` or `-ReverseProxy none` skips reverse proxy changes and
  tells you to route HTTPS to `http://127.0.0.1:8787` yourself.

If the helper cannot safely validate the reverse proxy config, it stops before
reload. That is intentional: existing VPN panels, Nginx sites, Caddy sites, or
firewall rules should not be broken silently.

For an existing Nginx server with a managed certificate:

```powershell
.\scripts\deploy-vps.ps1 `
  -SshHost "YOUR_SERVER_IP_OR_HOST" `
  -SshUser "ubuntu" `
  -Domain "ticktick-mcp.example.com" `
  -TickTickClientId "YOUR_TICKTICK_CLIENT_ID" `
  -ReverseProxy nginx `
  -NginxSslCertificatePath "/etc/letsencrypt/live/ticktick-mcp.example.com/fullchain.pem" `
  -NginxSslCertificateKeyPath "/etc/letsencrypt/live/ticktick-mcp.example.com/privkey.pem"
```

If the VPS already runs a VPN panel or a hand-managed Nginx/Caddy setup and you
do not want the helper touching proxy config, use `-ReverseProxy manual`. The
helper will still install/update the Node service and print the upstream target:
`http://127.0.0.1:8787`.

For a LAN or disposable VM staging test with self-signed HTTPS:

```powershell
.\scripts\deploy-vps.ps1 `
  -SshHost "192.168.0.100" `
  -SshUser "ubuntu" `
  -Domain "ticktick-mcp-staging.local" `
  -TickTickClientId "YOUR_TICKTICK_CLIENT_ID" `
  -ReverseProxy caddy `
  -StagingSelfSigned `
  -AllowSelfSignedHealthCheck
```

If you do not have local DNS for the staging VM, `-Domain` can be the VM or
host-forwarded IP address, for example `192.168.0.100`. In Caddy staging mode
the helper generates a short-lived self-signed certificate for IP-based HTTPS so
the health check can verify the reverse proxy path with `curl -k`.

Self-signed/internal TLS is useful for deploy smoke tests, but ChatGPT
connectors generally require publicly trusted HTTPS.

## After The Helper Finishes

In the TickTick developer app, set:

```text
OAuth redirect URL: https://ticktick-mcp.example.com/oauth/callback
```

Then open:

```text
https://ticktick-mcp.example.com/oauth/start
```

After TickTick authorization succeeds, check:

```text
https://ticktick-mcp.example.com/health
```

## ChatGPT Connector Settings

In ChatGPT Developer Mode, create a connector/app with:

```text
MCP server URL:    https://ticktick-mcp.example.com/mcp
Authentication:    OAuth
Authorization URL: https://ticktick-mcp.example.com/oauth/authorize
Token URL:         https://ticktick-mcp.example.com/oauth/token
Client ID:         ticktick-mcp-chatgpt
Client secret:     the CHATGPT_OAUTH_CLIENT_SECRET printed by the helper
Scopes:            ticktick:read ticktick:write
```

If ChatGPT only offers preset scope choices such as `default`, `standard`, or
`post`, choose the preset ChatGPT allows. The MCP server grants its configured
scopes and treats those presets as client compatibility aliases.

Scan tools after saving the connector. The expected tool count is currently
`40`.

## Updating An Existing VPS

Run the helper again with the same host, user, domain, and TickTick client
credentials. It will fetch the repository, fast-forward the configured branch,
rewrite the service environment, run checks, and restart systemd.

If you want to preserve already-generated ChatGPT secrets, pass them as secure
parameters instead of letting the helper generate new ones:

```powershell
$chatSecret = Read-Host "Existing ChatGPT OAuth client secret" -AsSecureString
$tokenSecret = Read-Host "Existing token signing secret" -AsSecureString
$bearerSecret = Read-Host "Existing APP_SHARED_SECRET" -AsSecureString

.\scripts\deploy-vps.ps1 `
  -SshHost "YOUR_SERVER_IP_OR_HOST" `
  -SshUser "YOUR_SSH_USER" `
  -Domain "ticktick-mcp.example.com" `
  -TickTickClientId "YOUR_TICKTICK_CLIENT_ID" `
  -ChatGptOAuthClientSecret $chatSecret `
  -ChatGptOAuthTokenSecret $tokenSecret `
  -AppSharedSecret $bearerSecret
```

## Manual Fallback

If you cannot use the helper, do the same steps manually:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
git clone https://github.com/zoomerland/ticktick-mcp-bridge.git /opt/ticktick-mcp-bridge
cd /opt/ticktick-mcp-bridge/plugins/ticktick-mcp-bridge
npm run check
npm test
```

Create `.env` in the package directory:

```text
PORT=8787
BIND_HOST=127.0.0.1
PUBLIC_BASE_URL=https://ticktick-mcp.example.com
TICKTICK_CLIENT_ID=your-client-id
TICKTICK_CLIENT_SECRET=your-client-secret
TICKTICK_REDIRECT_URI=https://ticktick-mcp.example.com/oauth/callback
APP_SHARED_SECRET=long-random-secret
CHATGPT_OAUTH_CLIENT_ID=ticktick-mcp-chatgpt
CHATGPT_OAUTH_CLIENT_SECRET=long-random-chatgpt-oauth-client-secret
CHATGPT_OAUTH_TOKEN_SECRET=long-random-token-signing-secret
TICKTICK_AUTH_FILE=/var/lib/ticktick-mcp-bridge/auth.json
```

Then create a systemd service and reverse proxy equivalent to what the helper
writes. Prefer the helper when possible; it keeps the commands aligned with the
repository.
