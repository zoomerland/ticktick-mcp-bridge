# TickTick MCP Bridge Architecture

This project is the shared TickTick MCP backend for Codex, ChatGPT, and other MCP clients.

## Current Shape

```text
src/
  auth-store.mjs        shared OAuth/token storage
  ticktick-api.mjs      TickTick Open API client
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

- TickTick business logic belongs in `src/ticktick-api.mjs` and `src/tools.mjs`.
- Tool names and schemas are defined once in `src/tools.mjs`.
- Transport-specific code must stay in `src/server.mjs` or `src/transports/*`.
- Codex plugin or local launcher files must not reimplement TickTick tools. They should only locate this backend and launch the stdio transport.
- ChatGPT-specific endpoint/tunnel settings must not change Codex stdio behavior.

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
