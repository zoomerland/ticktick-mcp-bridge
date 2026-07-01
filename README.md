# TickTick MCP Bridge Marketplace

This repository is a public Codex plugin marketplace for [TickTick MCP Bridge](plugins/ticktick-mcp-bridge/README.md).

TickTick MCP Bridge is a self-hosted MCP server for TickTick. It supports:

- Codex through local stdio MCP
- ChatGPT through a self-hosted HTTP `/mcp` endpoint
- one shared TickTick API core and one shared tool list
- a three-layer model: normalized TickTick data, agent-safe task workflows, and non-destructive diagnostics
- official Task, Project, Habit, and Focus/Pomodoro Open API coverage

No shared TickTick token is included. Every user authorizes their own TickTick account and stores tokens only in their own local machine or private deployment.

## Install In Codex

Add this GitHub repository as a Codex plugin marketplace:

```powershell
codex plugin marketplace add zoomerland/ticktick-mcp-bridge
```

Then open the plugin directory, select the `TickTick MCP Bridge` marketplace, and install `TickTick MCP Bridge`.

The bundled Codex launcher is Windows-friendly and searches for Node.js in `CODEX_NODE_PATH`, `NODE_EXE`, the Codex bundled runtime, and then `node.exe` on `PATH`. Non-Windows users can run the same backend directly with `node scripts/server.mjs` from the plugin folder.

The Codex plugin starts the local stdio MCP transport. For ChatGPT, follow the self-hosting guide:

- [User guide](plugins/ticktick-mcp-bridge/docs/USER_GUIDE.md)
- [Authorization](plugins/ticktick-mcp-bridge/docs/AUTH.md)
- [Self-hosting](plugins/ticktick-mcp-bridge/docs/SELF_HOSTING.md)
- [Architecture](plugins/ticktick-mcp-bridge/ARCHITECTURE.md)

## Repository Layout

```text
AGENTS.md
.agents/plugins/marketplace.json
.agents/orchestra/
integrations/telegram-bot/
integrations/local-stt-service/
plugins/ticktick-mcp-bridge/
  .codex-plugin/plugin.json
  .mcp.json
  README.md
  src/
  scripts/
  skills/
  docs/
```

## Agent Coordination

This repository includes a lightweight conductor-led coordination layer for
multi-agent work:

- [AGENTS.md](AGENTS.md)
- [.agents/orchestra/](.agents/orchestra/)

Runtime changes still belong in `plugins/ticktick-mcp-bridge/`. Do not commit
local deployment secrets or private agent notes.

The first Telegram secretary implementation slice lives in
[`integrations/telegram-bot/`](integrations/telegram-bot/). It is designed as a
separate process that talks to TickTick MCP Bridge over the MCP HTTP contract.
The local STT service boundary for future Telegram voice transcription lives in
[`integrations/local-stt-service/`](integrations/local-stt-service/). It ships
mock and command providers, but no model artifacts.

## Security

Do not commit `.env`, `data/`, or `auth.json`. See [SECURITY.md](SECURITY.md).
