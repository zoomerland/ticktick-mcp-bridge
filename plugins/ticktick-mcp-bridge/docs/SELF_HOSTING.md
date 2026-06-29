# Self-Hosting

This project is designed for single-user self-hosting. The Codex marketplace plugin can still run fully locally through stdio; HTTP self-hosting is optional and mainly for ChatGPT or other remote MCP clients.

## Local Development

```powershell
npm install
Copy-Item .env.example .env
npm run start:chatgpt
```

Local MCP URL:

```text
http://127.0.0.1:8787/mcp
```

ChatGPT needs a public HTTPS URL, so local-only HTTP is mainly for testing.

## Persistent Hosting Options

Good fits:

- a small VPS
- Google Cloud e2-micro Always Free, if configured inside free-tier limits
- Koyeb free web service for hobby/testing
- a home server with Cloudflare Tunnel or another stable HTTPS tunnel

See [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md) for an optional VPS recipe with Caddy, systemd, and bearer authentication.

Avoid relying on random temporary tunnel URLs as permanent ChatGPT endpoints. If the URL changes, update:

- `PUBLIC_BASE_URL`
- `TICKTICK_REDIRECT_URI`
- TickTick developer app redirect URI
- ChatGPT MCP server URL

## Required Environment

```text
PORT=8787
BIND_HOST=127.0.0.1
PUBLIC_BASE_URL=https://YOUR_PUBLIC_HOST
TICKTICK_CLIENT_ID=your-client-id
TICKTICK_CLIENT_SECRET=your-client-secret
TICKTICK_REDIRECT_URI=https://YOUR_PUBLIC_HOST/oauth/callback
APP_SHARED_SECRET=long-random-secret
```

For a VPS behind a reverse proxy, keep `BIND_HOST=127.0.0.1`. Use `BIND_HOST=0.0.0.0` only when you intentionally expose the Node server directly, and always set `APP_SHARED_SECRET`.

## Health Checks

```bash
curl https://YOUR_PUBLIC_HOST/health
curl https://YOUR_PUBLIC_HOST/tools
```

If `APP_SHARED_SECRET` is set, test MCP JSON-RPC with:

```bash
SMOKE_BASE_URL=https://YOUR_PUBLIC_HOST/mcp SMOKE_BEARER_TOKEN=long-random-secret npm run smoke
```

MCP endpoint:

```text
https://YOUR_PUBLIC_HOST/mcp
```

## Codex / Local MCP

Codex-style local usage can skip public HTTPS and use stdio:

```powershell
npm run start:codex
```

That path uses the same TickTick tools and auth logic as the HTTP transport.
