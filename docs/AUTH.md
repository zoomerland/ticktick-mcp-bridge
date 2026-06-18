# TickTick Authorization

Each user authorizes their own TickTick account. No shared token is included in this repository.

## 1. Create a TickTick Developer App

Open:

```text
https://developer.ticktick.com/manage
```

Create an app and copy:

- `client_id`
- `client_secret`

Set the redirect URI to match where this MCP server runs.

For local HTTP testing:

```text
http://127.0.0.1:8787/oauth/callback
```

For a public HTTPS deployment:

```text
https://YOUR_PUBLIC_HOST/oauth/callback
```

## 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill:

```text
TICKTICK_CLIENT_ID=your-client-id
TICKTICK_CLIENT_SECRET=your-client-secret
TICKTICK_REDIRECT_URI=http://127.0.0.1:8787/oauth/callback
```

For public HTTP MCP access, also set:

```text
APP_SHARED_SECRET=long-random-secret
```

## 3. Start the HTTP Server

```powershell
npm run start:chatgpt
```

Open:

```text
http://127.0.0.1:8787/oauth/start
```

Approve TickTick access. The server stores the resulting token locally.

## 4. Token Storage

Default Windows storage:

```text
%APPDATA%\Codex\ticktick-assistant\auth.json
```

Default non-Windows storage:

```text
~/.ticktick-assistant/auth.json
```

Override storage with:

```text
TICKTICK_AUTH_FILE=/private/path/auth.json
```

Do not commit this file.

## 5. MCP Setup Tools

The server also exposes setup helpers:

- `ticktick_auth_status`
- `ticktick_set_oauth_app`
- `ticktick_get_auth_url`
- `ticktick_exchange_code`
- `ticktick_set_bearer_token`
- `ticktick_clear_auth`

These are useful for local setup, but on an internet-facing deployment you should protect the HTTP endpoint before using them.
