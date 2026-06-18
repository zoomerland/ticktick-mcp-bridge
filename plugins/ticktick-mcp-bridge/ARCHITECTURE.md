# TickTick MCP Bridge Architecture

This project is the shared TickTick MCP backend for Codex, ChatGPT, and other MCP clients.

## Current Shape

```text
src/
  auth-store.mjs        shared OAuth/token storage
  ticktick-api.mjs      TickTick Open API client
  ticktick-data.mjs     normalized projects, Inbox, tasks, filtering, summaries
  task-operations.mjs   agent-oriented search, candidates, safe completion, task moves
  habit-operations.mjs  official Habit API helpers and check-in operations
  focus-operations.mjs  official Focus/Pomodoro API helpers and summaries
  diagnostics.mjs       non-destructive auth/API/Inbox/task visibility checks
  tools.mjs             single MCP tool list and handlers
  mcp-handler.mjs       shared JSON-RPC MCP handler
  server.mjs            HTTP MCP transport for ChatGPT
  transports/
    stdio.mjs           stdio MCP transport for Codex

connectors:
  Codex/local clients   stdio -> src/transports/stdio.mjs
  ChatGPT app           HTTPS URL -> /mcp
```

## Boundary Rules

- TickTick HTTP details belong in `src/ticktick-api.mjs`.
- Data normalization belongs in `src/ticktick-data.mjs`: projects, Inbox, project data, task fields, filters, due buckets, priorities, and workload summaries.
- Agent workflows belong in `src/task-operations.mjs`: ranked search, candidate decisions, safe completion, Inbox/overdue helpers, and task moves.
- Habit workflow helpers belong in `src/habit-operations.mjs`.
- Focus/Pomodoro workflow helpers belong in `src/focus-operations.mjs`.
- Health and visibility checks belong in `src/diagnostics.mjs`.
- Tool names and schemas are defined once in `src/tools.mjs`.
- Transport-specific code must stay in `src/server.mjs` or `src/transports/*`.
- Codex plugin or local launcher files must not reimplement TickTick tools. They should only locate this backend and launch the stdio transport.
- ChatGPT-specific endpoint/tunnel settings must not change Codex stdio behavior.

## Three-Layer Tool Model

The bridge intentionally exposes three layers:

1. Data layer: normalized `Task`, `ChecklistItem`, `Project`, `Column`, and `ProjectData` shapes. This layer preserves useful TickTick fields such as `content`, `desc`, `reminders`, `repeatFlag`, `items`, `kind`, `columnId`, `isAllDay`, `priority`, tags, project names, and due buckets.
2. Scenario layer: agent-safe operations such as `ticktick_search_tasks`, `ticktick_find_task_candidates`, `ticktick_complete_task_safe`, `ticktick_today`, `ticktick_overdue`, `ticktick_inbox`, official `task/filter` and `task/completed`, `ticktick_create_task`, `ticktick_update_task`, official `ticktick_move_task`, project tools, Habit tools, and Focus/Pomodoro tools.
3. Diagnostics layer: `ticktick_diagnostics` checks auth, endpoint availability, Inbox visibility, project counts, and task bucket counts without changing TickTick data.

When adding a new feature, prefer adding data support first, then a scenario tool, then a diagnostic check only if it helps prove visibility or setup.

## Official API Coverage

The official TickTick documentation is served as a docsify site:

```text
https://developer.ticktick.com/docs/index.html
https://developer.ticktick.com/docs/openapi.md
```

Typical Swagger/OpenAPI JSON paths such as `/openapi.json`, `/swagger.json`, `/v3/api-docs`, `/docs/openapi.json`, and `/docs/swagger.json` currently return 404 on `developer.ticktick.com`. Treat `docs/openapi.md` as the current official source unless TickTick publishes a machine-readable spec later.

Covered official Open API groups:

- Task: get, create, update, complete, delete, move, completed list, and filter.
- Project: list, get, data, create, update, delete.
- Focus: get by ID, list by time range, delete.
- Habit: list, get, create, update, check-in, list check-ins.

Not covered because no official Open API endpoint is documented: Countdown, calendar subscriptions, and Eisenhower Matrix.

## Auth Storage

By default on Windows, both transports use:

```text
%APPDATA%\Codex\ticktick-assistant\auth.json
```

This keeps local Codex and HTTP deployments on one token store when they run as the same user on the same machine. The older ChatGPT-specific path is still read as a fallback:

```text
%APPDATA%\Codex\ticktick-chatgpt-mcp\auth.json
```

Set `TICKTICK_AUTH_FILE` only when an intentionally separate token store is needed.

## TickTick Inbox

TickTick Inbox is not returned by the Open API `/project` list. The bridge adds Inbox as a pseudo-project:

```text
id: inbox
name: Inbox
```

Task listing and searching must include `/project/inbox/data` in addition to normal project data. This is a regression-tested behavior; run:

```powershell
npm run test:inbox
```

Do not implement project iteration that only walks `/project`, or Inbox tasks will disappear from search, workload summaries, and completion candidate lists.

## Transports

### Codex

Codex uses stdio MCP:

```powershell
npm run start:codex
```

If a launcher needs to point to a moved checkout, set:

```powershell
$env:TICKTICK_MCP_HOME = "C:\path\to\ticktick-chatgpt-mcp"
```

### ChatGPT

ChatGPT uses HTTP MCP:

```powershell
npm run start:chatgpt
```

Local endpoint:

```text
http://127.0.0.1:8787/mcp
```

ChatGPT itself needs a public HTTPS URL, so use a stable tunnel or deployment for real use. A temporary `trycloudflare.com` URL is only a short-lived development endpoint.

## Verification

After changes, run:

```powershell
npm run check
npm run start:chatgpt
```

Then in another shell:

```powershell
npm run smoke
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/tools
```

For Codex stdio, use the personal plugin or run `npm run start:codex` with a small MCP initialize/tools-list probe.
