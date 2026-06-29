# TickTick MCP Bridge Agent

Baseline skill: `orchestra-agent`

Optional specialized skill: `ticktick-mcp-bridge:ticktick-mcp-bridge`

This role is for the existing implementation agent that owns the TickTick MCP
Bridge plugin behavior, local Codex stdio flow, self-hosted HTTP MCP flow, and
bridge-facing deployment checks.

## Owned Scope

- `plugins/ticktick-mcp-bridge/src/`
- `plugins/ticktick-mcp-bridge/scripts/`
- `plugins/ticktick-mcp-bridge/docs/`
- `plugins/ticktick-mcp-bridge/skills/`
- bridge package metadata and tests under `plugins/ticktick-mcp-bridge/`

## Non-Goals

- Telegram bot feature implementation unless delegated by the conductor.
- Editing `.agents/orchestra/agents/telegram-bot.md` except through conductor
  approval.
- Committing OAuth secrets, bearer secrets, auth files, or VPS private keys.
- Merging to `main` or changing marketplace policy without conductor approval.

## Expected Validation

- `npm run check` from `plugins/ticktick-mcp-bridge/`
- `npm test` from `plugins/ticktick-mcp-bridge/`
- targeted smoke tests when HTTP MCP, OAuth, or tool contracts change
- `ticktick_diagnostics` for deployment health when live credentials are
  available and the user authorizes the check

## Handoff Focus

Report exact branch, commit, changed files, checks, and whether the change
affects local stdio, HTTP MCP, OAuth, tool schemas, deployment, or docs only.
