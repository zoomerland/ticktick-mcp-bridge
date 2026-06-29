# Telegram Bot Initial Handoff Plan

Date: 2026-06-24

## Role And Scope

- Role: Telegram Bot Agent.
- Scope: first architecture, security, and validation plan for adding a Telegram
  bot integration to TickTick MCP Bridge.
- Repo path: `C:\Users\Zoomerland\Documents\TiickTick`.
- Authorized write path for this task:
  `.agents/orchestra/handoffs/2026-06-24-telegram-bot-initial-plan.md`.
- Non-goals for this task: no runtime code changes, no edits under
  `plugins/ticktick-mcp-bridge/src`, no commits, and no pushes.

## Git State

- Current branch: `codex/orchestra-agents`.
- Current HEAD: `fc8d5caf86eba675443a7d20c88ac7fef7ba2c8c`
  (`Prefer Google Cloud free VPS guidance`).
- Tracking branch: none configured for `codex/orchestra-agents`.
- Remote: `origin` -> `https://github.com/zoomerland/ticktick-mcp-bridge.git`.
- Remote branch check: `origin/main` exists at
  `d86fcb61cd46c2d39f7818583487be08053a0ad9`; no remote refs were returned for
  `codex/orchestra-agents` or `codex/telegram-bot`.
- Pre-handoff `git status --short --branch`:

```text
## codex/orchestra-agents
 M .gitignore
 M README.md
?? .agents/orchestra/
?? AGENTS.md
?? output/
```

Assumption: although the Telegram role file suggests `codex/telegram-bot`, this
planning-only handoff is being written on the current orchestration branch
because the conductor/user explicitly authorized only this handoff file and
forbade commits/pushes. Future implementation should use a conductor-approved
Telegram branch, preferably `codex/telegram-bot`.

## Sources Inspected

- `AGENTS.md`
- `.agents/orchestra/README.md`
- `.agents/orchestra/agents/telegram-bot.md`
- `.agents/orchestra/handoffs/README.md`
- `plugins/ticktick-mcp-bridge/ARCHITECTURE.md`
- `plugins/ticktick-mcp-bridge/README.md`
- `plugins/ticktick-mcp-bridge/SECURITY.md`
- `plugins/ticktick-mcp-bridge/docs/AUTH.md`
- `plugins/ticktick-mcp-bridge/docs/SELF_HOSTING.md`
- `plugins/ticktick-mcp-bridge/docs/VPS_DEPLOYMENT.md`
- `plugins/ticktick-mcp-bridge/.env.example`
- `plugins/ticktick-mcp-bridge/package.json`

## Proposed Architecture

Use a separate Telegram bot process that talks to the existing TickTick MCP
Bridge over its public MCP contract instead of importing or duplicating bridge
internals.

Initial runtime mode should be Telegram long polling:

- simpler first VPS baseline;
- no public webhook endpoint or extra reverse-proxy route needed;
- outbound-only connection from the bot to Telegram;
- keeps the existing MCP server exposure model unchanged.

Recommended first topology:

```text
Telegram user
  -> Telegram Bot API
  -> ticktick-telegram-bot process
  -> http://127.0.0.1:8787/mcp
  -> TickTick MCP Bridge
  -> TickTick Open API
```

The bot should:

- authenticate Telegram users before every command;
- parse a narrow command set into MCP tool calls;
- call `initialize`, `tools/list`, and `tools/call` against the bridge MCP
  endpoint;
- prefer existing scenario tools such as `ticktick_today`, `ticktick_overdue`,
  `ticktick_inbox`, `ticktick_search_tasks`,
  `ticktick_find_task_candidates`, `ticktick_create_task`,
  `ticktick_update_task`, `ticktick_move_task`, and
  `ticktick_complete_task_safe`;
- run `ticktick_diagnostics` as the first bridge health check;
- require explicit confirmation for write operations;
- keep TickTick OAuth credentials and token storage owned by the bridge, not by
  the bot.

## Proposed File Layout

Preferred implementation root after conductor approval:

```text
integrations/telegram-bot/
  package.json
  README.md
  .env.example
  src/
    index.mjs
    config.mjs
    telegram-client.mjs
    authz.mjs
    command-router.mjs
    commands/
      today.mjs
      inbox.mjs
      overdue.mjs
      search.mjs
      create-task.mjs
      complete-task.mjs
      move-task.mjs
      diagnostics.mjs
    bridge-client.mjs
    confirmations.mjs
    formatters.mjs
    rate-limit.mjs
    logger.mjs
  test/
    config.test.mjs
    authz.test.mjs
    command-router.test.mjs
    bridge-client.test.mjs
    confirmations.test.mjs
```

Optional docs path:

```text
plugins/ticktick-mcp-bridge/docs/TELEGRAM_BOT.md
```

Rationale: `integrations/telegram-bot/` makes the bot clearly adjacent to the
bridge, not a Codex marketplace plugin. A bridge docs page can explain
deployment and MCP contract usage without coupling runtime code to bridge
internals.

Alternative path if the conductor wants marketplace-like packaging later:

```text
plugins/ticktick-telegram-bot/
```

## Proposed Environment Variables

Telegram bot:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_ALLOWED_CHAT_IDS=
TELEGRAM_ADMIN_USER_IDS=
TELEGRAM_BOT_MODE=polling
TELEGRAM_POLLING_TIMEOUT_SECONDS=30
TELEGRAM_POLLING_INTERVAL_MS=1000
TELEGRAM_CONFIRM_WRITES=true
TELEGRAM_REQUIRE_PROJECT_FOR_CREATION=true
TELEGRAM_DEFAULT_PROJECT_ID=
TELEGRAM_DEFAULT_PROJECT_NAME=
TELEGRAM_DEFAULT_TIMEZONE=Europe/Moscow
TELEGRAM_MAX_RESULTS=10
```

Bridge connection:

```text
TICKTICK_MCP_URL=http://127.0.0.1:8787/mcp
TICKTICK_MCP_BEARER_TOKEN=
TICKTICK_MCP_TIMEOUT_MS=15000
TICKTICK_MCP_STARTUP_DIAGNOSTICS=true
```

Operational:

```text
LOG_LEVEL=info
LOG_REDACT_TASK_CONTENT=true
BOT_RATE_LIMIT_WINDOW_MS=60000
BOT_RATE_LIMIT_MAX_COMMANDS=30
```

Future webhook-only variables, not required for the first baseline:

```text
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET_TOKEN=
TELEGRAM_WEBHOOK_BIND_HOST=127.0.0.1
TELEGRAM_WEBHOOK_PORT=8790
```

The bot should not need `TICKTICK_CLIENT_ID`, `TICKTICK_CLIENT_SECRET`,
`TICKTICK_ACCESS_TOKEN`, `TICKTICK_REFRESH_TOKEN`, or `TICKTICK_AUTH_FILE`.
Those remain bridge-owned.

## Auth And Security Plan

- Store `TELEGRAM_BOT_TOKEN` only in local/private deployment environment.
- Never commit Telegram tokens, chat IDs tied to private users, TickTick tokens,
  bearer secrets, task exports, or raw private logs.
- Require `TELEGRAM_ALLOWED_USER_IDS`; reject all other Telegram users by
  default.
- Treat group chats as disabled unless `TELEGRAM_ALLOWED_CHAT_IDS` explicitly
  allows them.
- Keep the bridge bound to `127.0.0.1` on the VPS where possible.
- If the bot calls a public HTTPS bridge endpoint, require bearer auth with
  `TICKTICK_MCP_BEARER_TOKEN` matching the bridge `APP_SHARED_SECRET`.
- Do not expose new bot HTTP endpoints for long polling mode.
- For future webhook mode, require HTTPS, Telegram webhook secret token
  verification, a narrow reverse proxy route, and no unauthenticated debug
  endpoints.
- Confirm all mutations before execution: create, update, move, complete, and
  delete.
- Prefer `ticktick_complete_task_safe` and candidate display for ambiguous
  natural-language completions.
- Hide or disable `ticktick_raw_request` from normal bot commands unless the
  conductor explicitly approves an admin-only escape hatch.
- Add per-user rate limits and command length limits.
- Redact bot token, bearer token, OAuth secrets, and auth file paths from logs.
- Log command metadata at most; avoid full task content in production logs unless
  the user opts in.
- Run bot and bridge as separate services/users when deployed on a VPS.
- Keep systemd env files mode `0600` and outside committed repo content.

## Integration Options With TickTick MCP Bridge

### Option A: HTTP MCP Client To Local Bridge (Preferred First)

The bot sends JSON-RPC MCP requests to `http://127.0.0.1:8787/mcp` on the same
host, or to the existing HTTPS MCP endpoint with bearer auth.

Pros:

- uses the bridge's stable public contract;
- avoids editing `plugins/ticktick-mcp-bridge/src`;
- works with the current HTTP transport and smoke pattern;
- keeps TickTick OAuth storage in one place;
- validates through `/health`, `/tools`, and `ticktick_diagnostics`.

Cons:

- requires the bridge HTTP service to be running;
- needs careful bearer secret handling if not loopback-only.

### Option B: Stdio MCP Child Process

The bot starts or connects to the bridge stdio transport.

Pros:

- useful for local desktop-only experiments;
- avoids public HTTP exposure.

Cons:

- more process lifecycle complexity on a VPS;
- weaker fit for systemd separation;
- harder to share one long-running bridge with ChatGPT.

### Option C: Shared Internal Library

Refactor bridge logic into a supported library surface and call that directly.

Pros:

- no MCP round trip;
- easier unit-level task operation calls.

Cons:

- requires bridge internals/API design and conductor approval;
- risks bypassing the single MCP tool contract;
- not suitable as the first implementation step.

### Option D: Direct TickTick API Client In Bot

The bot implements TickTick API calls itself.

Status: reject for the first plan. It duplicates bridge logic and risks
inconsistent Inbox, candidate, safe-completion, OAuth, Habit, and Focus
behavior.

## Initial Command Surface

Read-only first:

- `/start` - show authorized bot status and safe command list.
- `/diagnostics` - call `ticktick_diagnostics`.
- `/today` - call `ticktick_today`.
- `/overdue` - call `ticktick_overdue`.
- `/inbox` - call `ticktick_inbox`.
- `/search <query>` - call `ticktick_search_tasks` or
  `ticktick_find_task_candidates`.

Write commands after confirmation behavior is implemented:

- `/add <task>` - create a task only after explicit project/list routing, or
  after using a conductor-approved local default project. Do not silently route
  new tasks to Inbox when a suitable list/project is known.
- `/complete <query>` - find candidates, show exactly one safe match or ask user
  to choose, then call `ticktick_complete_task_safe`.
- `/move <query> -> <project/list>` - require candidate confirmation, then call
  `ticktick_move_task`.

Avoid broad natural-language automation in the first release. The first version
should be command-oriented and explicit.

## Validation Gates

Planning gate:

- Confirm governance files and Telegram role file were read.
- Confirm no runtime code or bridge `src` files were modified.
- Confirm exact branch/status before and after the handoff.

Implementation gate 1: static/config:

- `node --check` for bot source files.
- unit tests for config parsing, allowlist authorization, command routing,
  bridge client request shaping, and write confirmation state.
- startup with no token should fail closed with a redacted error.
- startup with token but no allowed users should fail closed.

Implementation gate 2: bridge contract:

- bridge `/health` returns healthy enough for local service discovery.
- bridge `/tools` is reachable.
- MCP `initialize` and `tools/list` work with bearer when configured.
- `ticktick_diagnostics` returns a non-destructive status.

Implementation gate 3: synthetic bot behavior:

- unauthorized Telegram update is rejected.
- authorized `/diagnostics`, `/today`, `/inbox`, and `/search` are routed to the
  expected MCP calls against a mocked bridge.
- mutation command without confirmation does not call the bridge mutation tool.
- ambiguous completion displays candidates instead of completing a task.

Implementation gate 4: no-secret runtime smoke:

- bot starts in polling mode with fake Telegram client or dry-run adapter.
- logs do not print token values or bearer secrets.
- rate limiter blocks repeated synthetic commands.

Implementation gate 5: controlled live smoke after user approval:

- run bridge diagnostics against the real deployment.
- send `/diagnostics` from an allowed Telegram user.
- send one read-only command such as `/today`.
- only after explicit approval, create and complete a clearly named temporary
  test task.

Deployment gate:

- run bridge and bot as separate services.
- bridge remains loopback-bound behind existing reverse proxy if public MCP is
  needed.
- bot long polling requires no new public inbound port.
- journal/log review confirms secrets are redacted.

## Open Questions For The Conductor

- Should the implementation branch be created as `codex/telegram-bot` before any
  code is added?
- Is `integrations/telegram-bot/` approved as the owned runtime path?
- Should the first bot target the existing VPS, a local Windows host, or both?
- Should the bot call the bridge over loopback HTTP MCP, public HTTPS MCP, or
  stdio for the first implementation?
- Should the first release be read-only except for one confirmed `/add` command,
  or should `/complete` and `/move` also be in scope?
- What Telegram user IDs and chat IDs should be authorized, and should group
  chats be disabled by default?
- Should task content be logged in development, or should logs default to
  metadata-only from the start?
- Should the bot support Russian command aliases in the first version?
- Is `ticktick_raw_request` entirely out of scope for Telegram, or allowed as an
  admin-only command later?
- What should the bot do when the bridge diagnostics report missing TickTick
  OAuth state: show setup guidance only, or expose any setup flow?
- Should the bot share the existing bridge `APP_SHARED_SECRET` value through a
  separate env name, or should it get a distinct bridge-side bot credential in a
  future bridge auth model?

## Checks Run

- Read `orchestra-agent` skill.
- Read required governance and Telegram role files.
- Inspected bridge docs and package metadata listed above.
- Ran `git status --short --branch`.
- Ran `git status -sb`.
- Ran `git branch -vv`.
- Ran `git rev-parse --show-toplevel`.
- Ran `git worktree list --porcelain`.
- Ran `git rev-parse --abbrev-ref --symbolic-full-name '@{u}'`, which reported
  no upstream configured for `codex/orchestra-agents`.
- Ran `git ls-remote --heads origin codex/orchestra-agents codex/telegram-bot main`.
- Ran `rg --files -g '!plugins/ticktick-mcp-bridge/src/**'`.

No runtime tests were run because this task is planning-only and forbids runtime
code changes.

## Files Changed

- Created
  `.agents/orchestra/handoffs/2026-06-24-telegram-bot-initial-plan.md`.

No files under `plugins/ticktick-mcp-bridge/src` were edited.

## Artifacts Created Or Downloaded

- Created one handoff Markdown file.
- Downloaded no artifacts.

## Privacy Handling

- No secrets were read, requested, printed, committed, or written.
- No Telegram token, TickTick token, OAuth client secret, bearer token, chat ID,
  user ID, task export, or raw private log is included.
- Proposed secret names are placeholders only.

## Unresolved Risks

- Current branch is orchestration-focused and has no upstream; future runtime
  work should move to a conductor-approved Telegram branch.
- Existing working tree already contains unrelated modified/untracked files.
  They were not touched by this task.
- The exact bridge auth model for bot-to-bridge calls may need a future
  first-class credential instead of reusing `APP_SHARED_SECRET`.
- Telegram user/chat authorization cannot be finalized without private IDs,
  which should remain out of the public repository.
- Live Telegram validation requires explicit user approval and a real bot token.

## Recommended Next Step

Conductor should review this plan, answer the open questions, approve the owned
path and branch, then assign a narrow implementation task for a read-only
long-polling bot skeleton with mocked bridge tests and no live Telegram call.

## Notify Next

- Conductor: review architecture, branch/path ownership, and open questions.
- TickTick MCP Bridge Agent: review MCP contract assumptions before bot
  implementation starts.
