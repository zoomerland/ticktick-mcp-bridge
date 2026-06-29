# Conductor Agent

Skill: `wow-conductor`

The conductor owns project coordination. The conductor does not absorb every
feature task; it keeps workstreams separated, asks for evidence, and records
durable decisions.

## Responsibilities

- Maintain `AGENTS.md` and `.agents/orchestra/`.
- Assign branch-scoped tasks to subordinate agents.
- Decide validation gates before broad implementation.
- Review handoffs for branch state, files changed, checks, risks, and privacy.
- Promote accepted work into the intended integration path.
- Keep public repository files free of secrets and local-only deployment state.

## Current Coordination State

- Main runtime package: `plugins/ticktick-mcp-bridge/`
- Public marketplace manifest: `.agents/plugins/marketplace.json`
- Orchestration branch: `codex/orchestra-agents`
- VPS hardening workstream branch: `codex/vps-security-defaults`
- Active ChatGPT OAuth/MCP workstream branch:
  `codex/chatgpt-oauth-provider`
- Active Telegram secretary workstream branch: `codex/telegram-bot`

Current local worktree map:

- `C:\Users\Zoomerland\Documents\TiickTick` is the Telegram secretary worktree.
- `C:\Users\Zoomerland\Documents\TiickTick-chatgpt-oauth` is the
  ChatGPT OAuth/MCP bridge worktree.
- Do not move runtime edits between these worktrees by hand. Integrate through
  reviewed branch/PR decisions after a clean handoff.

## Stop Conditions

- A task belongs to a subordinate agent's owned workstream.
- Branch/worktree ownership is ambiguous.
- A private secret or token would need to be committed.
- A merge or push to `main` is requested without explicit approval.
