# Orchestra Workspace

This folder contains durable coordination files for conductor-led multi-agent
work in this repository.

Read order for any agent:

1. `AGENTS.md`
2. this file
3. the assigned role file under `agents/`
4. the assigned handoff or task note, if one exists

## Layout

```text
.agents/orchestra/
  README.md
  agents/
    conductor.md
    ticktick-mcp-bridge.md
    telegram-bot.md
  handoffs/
    README.md
  private/
    deployment.local.md
```

`private/` and `*.local.md` files are ignored by Git and are for machine-local
deployment facts only.

## Operating Rule

Agents do not own the whole repository by default. The conductor assigns branch,
scope, allowed files, validation, and stop conditions. If those facts are
missing, the agent should stop and ask for clarification instead of guessing.

## Active Worktrees

As of 2026-06-30:

- `C:\Users\Zoomerland\Documents\TiickTick`
  - branch: `codex/telegram-bot`
  - purpose: Telegram secretary and local STT integration work
- `C:\Users\Zoomerland\Documents\TiickTick-chatgpt-oauth`
  - branch: `main`
  - purpose: accepted TickTick MCP Bridge baseline, ChatGPT/self-hosted HTTP
    MCP behavior, and optional VPS deployment helper

If a task mentions remote MCP, ChatGPT OAuth, Caddy, VPS deployment, or
`plugins/ticktick-mcp-bridge/` HTTP behavior, start from the OAuth/MCP worktree
on `main` unless the conductor explicitly assigns a fresh branch.

If a task mentions Telegram, secretary behavior, reminders, check-ins,
proactive flows, or local STT, start from the Telegram worktree.
