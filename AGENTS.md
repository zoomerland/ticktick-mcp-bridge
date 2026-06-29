# TickTick MCP Bridge Orchestra

This repository is both:

- the public Codex plugin marketplace wrapper for TickTick MCP Bridge;
- the coordination surface for private deployment and integration work around
  that plugin.

Runtime code lives under `plugins/ticktick-mcp-bridge/`. Agent coordination
lives under `.agents/orchestra/`.

## Durable Source Of Truth

Use this file first when starting work in this repository. Then read the
relevant role file in `.agents/orchestra/agents/`.

Chat history is not durable project state. Durable decisions, agent assignments,
handoffs, and validation notes belong in repository files or ignored private
notes when they contain local deployment details.

## Skills

- The conductor uses the `wow-conductor` skill.
- Every subordinate agent uses the `orchestra-agent` skill before task actions.
- The TickTick MCP Bridge agent may also use
  `ticktick-mcp-bridge:ticktick-mcp-bridge` for bridge-specific checks.
- Specialized skills may be added by the conductor per task, but they do not
  replace the `orchestra-agent` baseline for subordinate agents.

## Current Roster

- Conductor: owns orchestration, scope, branches, handoffs, and integration
  decisions. Role file: `.agents/orchestra/agents/conductor.md`.
- TickTick MCP Bridge Agent: owns the existing plugin implementation and
  deployment-facing bridge behavior. Role file:
  `.agents/orchestra/agents/ticktick-mcp-bridge.md`.
- Telegram Bot Agent: owns the future Telegram bot workstream and its handoff
  back to the conductor. Role file:
  `.agents/orchestra/agents/telegram-bot.md`.

## Branch And Workspace Rules

- Use separate branches for separate workstreams.
- Do not merge into `main` from an agent branch without conductor approval.
- Do not push commits into another agent's branch unless explicitly asked to
  repair coordination damage.
- Do not revert user changes or another agent's work. If a conflict appears,
  report it with exact files and branch state.
- Run `git status --short --branch` before and after a task.
- Treat branch/worktree identity as part of the task scope. If the current
  worktree is on `codex/telegram-bot`, do not edit MCP/OAuth runtime code
  there. If the current worktree is on `codex/chatgpt-oauth-provider`, do not
  edit Telegram runtime code there.
- Coordination documents may describe multiple workstreams, but runtime changes
  must stay in the owning workstream until the conductor explicitly approves an
  integration step.

Suggested branch names:

- orchestration and governance: `codex/orchestra-agents`
- TickTick bridge implementation: `codex/ticktick-mcp-bridge-agent`
- Telegram bot work: `codex/telegram-bot`

## Current Workstream Map

As of 2026-06-29, the local work is split across two active worktrees:

- `C:\Users\Zoomerland\Documents\TiickTick`
  - branch: `codex/telegram-bot`
  - owns: Telegram secretary and local STT work under `integrations/`
  - status: local dirty worktree, not pushed as a Telegram branch
- `C:\Users\Zoomerland\Documents\TiickTick-chatgpt-oauth`
  - branch: `codex/chatgpt-oauth-provider`
  - owns: ChatGPT/self-hosted HTTP MCP OAuth provider and VPS-facing bridge
    fixes under `plugins/ticktick-mcp-bridge/`
  - status: pushed branch, draft PR exists, deployed to the private VPS for
    live validation

Earlier VPS hardening lives on `codex/vps-security-defaults`. The
`codex/chatgpt-oauth-provider` workstream builds on that deployment direction.
Do not assume those changes are present in `main` or in `codex/telegram-bot`
until the conductor accepts and integrates the relevant PRs.

## Public And Private Data

This is a public repository. Do not commit:

- TickTick OAuth client secrets;
- TickTick access or refresh tokens;
- `APP_SHARED_SECRET` bearer tokens;
- Telegram bot tokens;
- VPS private keys;
- private user data, task exports, logs with secrets, or raw local runtime
  state.

Use `.agents/orchestra/private/` for local deployment notes that should remain
untracked. Keep secrets out of those notes unless the user explicitly asks for a
local-only secret inventory.

## Handoff Requirements

Every subordinate agent handoff must include:

- role and exact scope;
- repo path and branch;
- tracking branch and clean or dirty status;
- commit hash and pushed state, if commits were made;
- files changed;
- checks run and results;
- artifacts downloaded or created;
- privacy handling;
- unresolved risks;
- recommended next step;
- who should be notified next.

## Validation Gates

Prefer narrow gates before broad end-to-end work:

- source/static inspection;
- configuration validation;
- health endpoint smoke;
- synthetic API or MCP request smoke;
- one minimal user-facing flow;
- broader runtime or deployment checks only after the service boundary is clean.

For the remote MCP deployment, verify HTTPS, bearer authentication, TickTick
OAuth state, and `ticktick_diagnostics` before declaring the deployment healthy.

## Current Integration Direction

The current stable baseline is TickTick MCP Bridge as the shared backend for
Codex local stdio usage and ChatGPT/self-hosted HTTP MCP usage.

The remote ChatGPT OAuth/MCP deployment work is currently separate from the
Telegram branch. It is validated on the private VPS, but it remains a bridge
workstream until reviewed and integrated.

The current expansion branch contains the first Telegram secretary
implementation under `integrations/telegram-bot/` plus a local STT service
boundary under `integrations/local-stt-service/`.

The next Telegram gates are live read-only Telegram smoke, disposable confirmed
TickTick writes, and then a real local STT provider behind the existing
`/transcribe` contract.
