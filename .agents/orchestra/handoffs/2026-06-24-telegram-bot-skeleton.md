# Telegram Bot Skeleton Handoff

Date: 2026-06-24

## Role And Scope

- Conductor-owned implementation pass for the first Telegram secretary slice.
- Repo path: `C:\Users\Zoomerland\Documents\TiickTick`.
- Branch: `codex/telegram-bot`.
- HEAD before local changes: `fc8d5caf86eba675443a7d20c88ac7fef7ba2c8c`.
- Tracking branch: none configured.

## Files Changed

- Added `AGENTS.md`.
- Added `.agents/orchestra/` governance, roles, product spec, and handoffs.
- Added `integrations/telegram-bot/` as the approved initial runtime path.
- Updated root `README.md`.
- Updated `.gitignore` for orchestra private notes and bot `.env`.

## Implementation Summary

Created a dependency-free Node.js Telegram bot skeleton:

- fail-closed config for live polling;
- built-in `.env` parsing without npm dependencies;
- Telegram allowlist authorization;
- group chats denied unless explicitly allowlisted;
- in-memory rate limiter;
- Telegram Bot API polling/send client;
- MCP HTTP JSON-RPC bridge client;
- read-only commands:
  - `/diagnostics`
  - `/brief`
  - `/today`
  - `/overdue`
  - `/inbox`
  - `/search <query>`
- write commands recognized but blocked until confirmation state exists;
- plain text and `/capture <text>` create a safe task draft with clarifying
  questions instead of writing to TickTick.

Follow-up progress in the same branch added:

- in-memory pending task draft state;
- `/confirm` and `/cancel`;
- confirmed `/add` through `ticktick_create_task` when required questions are
  closed;
- `/proactive` manual review command;
- optional periodic proactive loop controlled by `TELEGRAM_PROACTIVE_ENABLED`;
- quiet-hours handling through `TELEGRAM_QUIET_HOURS`;
- schedule repair draft for signals such as "I am late" or "cancel today's
  plans";
- duplicate suppression for unchanged proactive nudges.

The first secretary-like behavior is `/brief`, which gathers today and Inbox
state and suggests a focus. The first capture behavior handles the user's doctor
trip example by asking for trip duration or route before any task creation.

## Checks Run

Using bundled Node:

```text
C:\Users\Zoomerland\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts\check.mjs
```

Result: `Checked 18 JavaScript modules.`

```text
C:\Users\Zoomerland\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test
```

Initial result: 20 tests, 20 pass.

Latest result after confirmation/proactive/repair work: 31 tests, 31 pass.

```text
C:\Users\Zoomerland\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts\dry-run.mjs
```

Result: dry-run prints `/start`, `/diagnostics`, `/brief`, `/proactive`,
schedule repair, doctor-trip capture, `/today`, `/search`, `/add`, and protected
`/confirm` without secrets.

```text
C:\Users\Zoomerland\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts\proactive-dry-run.mjs
```

Result: proactive review dry-run prints one candidate nudge and structured
reason counters.

## Privacy Handling

- No Telegram token was requested or used.
- No TickTick token or bearer secret was printed or written.
- No live Telegram call was made.
- No live TickTick write was made. Confirmed `/add` is implemented but covered
  only by mocked tests in this pass.
- `.env` is ignored.

## Known Limitations

- No live Telegram smoke yet; it requires `TELEGRAM_BOT_TOKEN` and a private
  allowed user ID.
- Only confirmed `/add` exists; `/complete`, `/move`, and schedule repair writes
  are not implemented.
- No persistent conversation state yet.
- No voice transcription yet.
- Proactive timer service exists but is disabled by default and not live-smoked.

## Recommended Next Gate

Run a read-only/live `/diagnostics` smoke from an allowed Telegram user. After
that, live-test confirmed `/add` with a disposable task and implement confirmed
`/complete` plus schedule repair writes with candidate selection.
