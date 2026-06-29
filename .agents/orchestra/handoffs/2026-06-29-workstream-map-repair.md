# Workstream Map Repair Handoff

Date: 2026-06-29

## Role And Scope

- Conductor-owned coordination repair.
- Repo path: `C:\Users\Zoomerland\Documents\TiickTick`.
- Current branch: `codex/telegram-bot`.
- Scope: clarify durable branch/worktree ownership after parallel MCP/OAuth and
  Telegram work became easy to confuse.
- Non-goals: no runtime code changes, no merge to `main`, no push to GitHub,
  no secret inventory, and no movement of commits between workstreams.

## Current Worktree Map

- `C:\Users\Zoomerland\Documents\TiickTick`
  - branch: `codex/telegram-bot`
  - owns Telegram secretary and local STT work under `integrations/`
  - current state before this handoff: dirty local worktree with uncommitted
    Telegram/orchestration files
- `C:\Users\Zoomerland\Documents\TiickTick-chatgpt-oauth`
  - branch: `codex/chatgpt-oauth-provider`
  - owns ChatGPT/self-hosted HTTP MCP OAuth provider and VPS-facing bridge
    fixes under `plugins/ticktick-mcp-bridge/`
  - latest known pushed commit: `abbdd9e`
  - deployed to the private VPS for live validation

Earlier VPS hardening remains on `codex/vps-security-defaults`. The
`codex/chatgpt-oauth-provider` branch builds on that direction and should be
reviewed/integrated as bridge work, not as Telegram work.

## Files Changed

- `AGENTS.md`
- `.agents/orchestra/README.md`
- `.agents/orchestra/agents/conductor.md`
- `.agents/orchestra/roadmap.md`
- `.agents/orchestra/handoffs/2026-06-29-workstream-map-repair.md`

## Coordination Decision

- Telegram runtime code stays on `codex/telegram-bot`.
- ChatGPT OAuth/MCP bridge runtime code stays on
  `codex/chatgpt-oauth-provider`.
- Coordination docs may mention both branches, but runtime edits must stay in
  the owning worktree until the conductor approves an integration step.
- Before any GitHub push, stop and choose the publication shape: one branch/PR
  for Telegram plus coordination, a separate governance-only branch, or a
  staged sequence that lands MCP/OAuth first.

## Checks Run

- `git status -sb`
- `git branch --show-current`
- `git remote -v`
- `git worktree list`
- `git branch -vv --all`
- `rg` over `AGENTS.md` and `.agents/orchestra/` for stale branch references

No runtime tests were run because this handoff changes coordination documents
only.

## Privacy Handling

- Did not read or print ignored private deployment notes.
- Did not print OAuth client secrets, bearer tokens, Telegram tokens, chat IDs,
  or private task data.
- No files under `.agents/orchestra/private/` were changed.

## Recommended Next Step

Review the local documentation diff, then decide how to publish:

1. keep coordination docs inside the Telegram PR/branch;
2. split coordination docs to `codex/orchestra-agents`; or
3. publish MCP/OAuth PR first, then rebase/refresh the Telegram branch against
   the accepted bridge baseline.
