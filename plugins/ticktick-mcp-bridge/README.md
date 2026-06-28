# TickTick MCP Bridge

Self-hosted MCP server for using the TickTick Open API from ChatGPT, Codex, and other MCP clients.

The TickTick API logic and MCP tool definitions live here once. Codex uses the stdio transport, while ChatGPT uses the HTTP `/mcp` transport.

This project does not include any shared TickTick token. Each user runs their own instance, creates or provides their own TickTick OAuth credentials, authorizes TickTick once, and stores tokens only in their own local or private deployment storage.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the separation between shared core, transports, and connector-specific configuration.
Start with [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for a user-facing overview of what the plugin can and cannot do.
See [docs/OFFICIAL_API_COVERAGE.md](docs/OFFICIAL_API_COVERAGE.md) for the current official TickTick endpoint coverage and Swagger/OpenAPI JSON probe notes.

## What It Exposes

For a less technical walkthrough with example prompts, see [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

- OAuth/setup helpers:
  - `ticktick_auth_status`
  - `ticktick_set_oauth_app`
  - `ticktick_get_auth_url`
  - `ticktick_exchange_code`
  - `ticktick_set_bearer_token`
  - `ticktick_clear_auth`
- Projects/lists:
  - `ticktick_list_projects`
  - `ticktick_get_project`
  - `ticktick_create_project`
  - `ticktick_update_project`
  - `ticktick_delete_project`
  - `ticktick_get_project_data`
- Tasks:
  - `ticktick_get_task`
  - `ticktick_list_tasks`
  - `ticktick_filter_tasks_official`
  - `ticktick_list_completed_tasks`
  - `ticktick_search_tasks`
  - `ticktick_find_task_candidates`
  - `ticktick_today`
  - `ticktick_overdue`
  - `ticktick_inbox`
  - `ticktick_analyze_workload`
  - `ticktick_create_task`
  - `ticktick_update_task`
  - `ticktick_move_task`
  - `ticktick_complete_task`
  - `ticktick_complete_task_safe`
  - `ticktick_delete_task`
- Diagnostics:
  - `ticktick_diagnostics`
- Focus/Pomodoro:
  - `ticktick_list_focuses`
  - `ticktick_get_focus`
  - `ticktick_analyze_focus`
  - `ticktick_delete_focus`
- Habits:
  - `ticktick_list_habits`
  - `ticktick_get_habit`
  - `ticktick_create_habit`
  - `ticktick_update_habit`
  - `ticktick_checkin_habit`
  - `ticktick_list_habit_checkins`
- Escape hatch:
  - `ticktick_raw_request`

The raw request tool can call any TickTick Open API endpoint under `https://api.ticktick.com/open/v1`, so newly-added official endpoints can be used before a dedicated tool exists.

`ticktick_list_projects` includes TickTick Inbox as a pseudo-project. TickTick's `/project` response does not list Inbox, so the bridge reads Inbox tasks separately through `/project/inbox/data` when listing or searching tasks. This behavior is covered by `npm run test:inbox`.

For natural-language task changes, prefer the safe workflow:

1. `ticktick_search_tasks` or `ticktick_find_task_candidates`
2. If the result is ambiguous, show the candidates instead of acting.
3. Use `ticktick_complete_task_safe` with exact IDs, or with a query only when it resolves to one safe candidate.

`ticktick_diagnostics` is non-destructive and checks auth, project access, Inbox visibility, and task counts. It is the fastest first check when the bridge looks connected but task results seem incomplete.

Habit and Focus/Pomodoro tools are based on the official TickTick Open API `Habit` and `Focus` sections. Countdown, calendar subscriptions, and Eisenhower Matrix are not exposed by the official Open API at this time, so this bridge does not implement them as first-class TickTick tools.

## Local Setup

Install dependencies if you use a regular Node.js checkout:

```powershell
npm install
```

Run local checks:

```powershell
npm run check
npm run test:inbox
npm run test:task-operations
npm run test:official-openapi
```

Copy `.env.example` to `.env` or set equivalent environment variables:

```powershell
$env:PORT = "8787"
$env:BIND_HOST = "127.0.0.1"
$env:PUBLIC_BASE_URL = "http://127.0.0.1:8787"
$env:TICKTICK_CLIENT_ID = "your-client-id"
$env:TICKTICK_CLIENT_SECRET = "your-client-secret"
$env:TICKTICK_REDIRECT_URI = "http://127.0.0.1:8787/oauth/callback"
```

Register the same redirect URI in the TickTick developer app.

Start the server:

```powershell
npm run start:chatgpt
```

Then open:

```text
http://127.0.0.1:8787/oauth/start
```

After authorizing TickTick, the server stores the token in `TICKTICK_AUTH_FILE` or the default app data path. The token file is intentionally ignored by git.

See [docs/AUTH.md](docs/AUTH.md) for the complete self-hosted authorization flow.

## ChatGPT Developer Mode

ChatGPT needs a remote HTTPS MCP URL. For local testing, expose this server with a secure tunnel, then create an app in ChatGPT:

1. ChatGPT settings -> Apps -> Advanced settings -> Developer mode.
2. Create app.
3. MCP server URL: `https://YOUR_PUBLIC_HOST/mcp`.
4. Authentication: OAuth.
5. Authorization URL: `https://YOUR_PUBLIC_HOST/oauth/authorize`.
6. Token URL: `https://YOUR_PUBLIC_HOST/oauth/token`.
7. Client ID: `CHATGPT_OAUTH_CLIENT_ID`.
8. Client secret: `CHATGPT_OAUTH_CLIENT_SECRET`.
9. Scopes: `ticktick:read ticktick:write` if the field accepts custom scopes. If ChatGPT only offers preset scopes such as `default`, `standard`, or `post`, choose the preset ChatGPT allows; the server will still grant its configured MCP scopes.
10. Scan tools.

For a persistent setup, deploy this server to a private host and set:

```text
BIND_HOST=127.0.0.1
PUBLIC_BASE_URL=https://YOUR_PUBLIC_HOST
TICKTICK_REDIRECT_URI=https://YOUR_PUBLIC_HOST/oauth/callback
APP_SHARED_SECRET=long-random-secret
CHATGPT_OAUTH_CLIENT_ID=ticktick-mcp-chatgpt
CHATGPT_OAUTH_CLIENT_SECRET=long-random-chatgpt-oauth-client-secret
CHATGPT_OAUTH_TOKEN_SECRET=long-random-token-signing-secret
```

Then update the TickTick developer app redirect URI to match.

See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for deployment notes and [docs/VPS_DEPLOYMENT.md](docs/VPS_DEPLOYMENT.md) for an optional VPS recipe.

## Codex

Codex uses the same backend through stdio:

```powershell
npm run start:codex
```

Codex can launch this project directly through `src/transports/stdio.mjs`, so Codex and ChatGPT share one tool list and one TickTick API implementation.

The marketplace plugin uses `scripts/run-server.cmd` on Windows so it can find the Codex bundled Node runtime even when `node` is not on `PATH`. On non-Windows systems, run `node scripts/server.mjs` or adjust `.mcp.json` to point to your Node executable.

If this project is moved, set `TICKTICK_MCP_HOME` to the project root before launching the Codex plugin.

## Security Notes

- Do not expose this server publicly without authentication. The HTTP server binds to `127.0.0.1` by default; set `BIND_HOST=0.0.0.0` only when you intentionally expose it and have `APP_SHARED_SECRET` configured.
- If `APP_SHARED_SECRET` is set, MCP requests must include `Authorization: Bearer <secret>`.
- Write tools can create, update, complete, and delete TickTick data. ChatGPT may ask for confirmation for consequential actions, but the server itself will execute valid tool calls.
- The setup tools accept secrets as arguments. For production, prefer environment variables and disable public access to setup flows at the network layer.
- Do not commit `.env`, `data/`, or any `auth.json` file.

See [SECURITY.md](SECURITY.md).

## Transport

The shared MCP handler supports:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`

Transports:

- HTTP `/mcp` for ChatGPT
- stdio for Codex

Debug endpoints:

- `GET /health`
- `GET /tools`

## References

- OpenAI remote MCP / connectors docs: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- OpenAI MCP server guide: https://developers.openai.com/api/docs/mcp
- ChatGPT Developer Mode help: https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta
- TickTick Open API entry point: https://developer.ticktick.com/docs#/openapi
- TickTick Open API Markdown source: https://developer.ticktick.com/docs/openapi.md
