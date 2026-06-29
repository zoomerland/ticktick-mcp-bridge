# Telegram Bot Live Readiness Handoff

Date: 2026-06-24

## Role And Scope

- Conductor-owned live-readiness gate for the Telegram secretary.
- Repo path: `C:\Users\Zoomerland\Documents\TiickTick`.
- Branch: `codex/telegram-bot`.
- Tracking branch: none configured.
- Base commit: `fc8d5caf86eba675443a7d20c88ac7fef7ba2c8c`.
- Worktree status: dirty local worktree; no commits or pushes made.
- Scope: private local `.env`, live Telegram readiness, and bounded one-shot
  Telegram polling smoke.
- Non-goals: no live TickTick writes, no autonomous loops, no voice/STT, no
  committed secrets, and no long-running bot process.

## Files Changed

- `.agents/orchestra/roadmap.md`
- `.agents/orchestra/handoffs/2026-06-24-telegram-bot-live-readiness.md`
- `integrations/telegram-bot/README.md`
- `integrations/telegram-bot/docs/DEPLOYMENT.md`
- `integrations/telegram-bot/package.json`
- `integrations/telegram-bot/scripts/live-poll-once.mjs`
- `integrations/telegram-bot/src/telegram-client.mjs`
- `integrations/telegram-bot/test/telegram-client.test.mjs`

## Private Runtime State

- Local ignored file `integrations/telegram-bot/.env` exists.
- `.env` contains the Telegram bot token, one allowlisted Telegram user id, the
  protected remote MCP URL, and the remote bridge bearer token.
- `git check-ignore -v integrations/telegram-bot/.env` confirms the file is
  ignored by `.gitignore`.
- Secret values were not printed in handoff files and are not intended for Git.

## Behavior Added

- `TelegramClient.getUpdates` accepts an optional Telegram Bot API `limit`.
- `scripts/live-poll-once.mjs` performs a bounded live Telegram smoke:
  - forces `TELEGRAM_DRY_RUN=false`;
  - forces autonomous loops off;
  - keeps confirmed writes off unless both `LIVE_POLL_ONCE_ALLOW_WRITES=true`
    and `TELEGRAM_CONFIRM_WRITES=true` are set for a one-shot disposable write
    gate;
  - runs startup diagnostics;
  - fetches at most a small limited batch of updates;
  - routes normal command replies;
  - acknowledges the processed update offset;
  - prints only update ids, command labels, authorization state, kind, and send
    status.
- Deployment docs now place `live-poll-once` after the user sends one live
  `/diagnostics` command.

## Checks Run

Using bundled Node from Codex runtime:

```text
node scripts/check.mjs
```

Result: `Checked 55 JavaScript modules.`

```text
node --test --test-reporter=tap
```

Result: 118 tests, 118 pass.

After adding the one-shot write opt-in to `live-poll-once`:

```text
node scripts/check.mjs
```

Result: `Checked 55 JavaScript modules.`

```text
node --test --test-reporter=tap test\telegram-client.test.mjs test\command-router.test.mjs
```

Result: 44 tests, 44 pass.

```text
TELEGRAM_DRY_RUN=false node scripts/live-readiness.mjs
```

Result: live config valid; protected bridge read-only smoke passed; Telegram
Bot API `getMe` returned the expected private bot identity; no polling,
messaging, or write flow was called.

```text
node scripts/live-poll-once.mjs
```

Result: startup diagnostics passed, no pending Telegram updates were available:
`updateCount: 0`.

After the user sent messages to the private Telegram bot, the same command was run
again.

Result: startup diagnostics passed; three authorized updates were processed;
three replies were sent; the next update offset was acknowledged.

Summary:

- `/start` produced a local reply.
- One plain text update produced a task-draft reply with no TickTick write.
- `/diagnostic` produced an unknown-command reply because the implemented
  command is `/diagnostics`.

After the user sent `/cancel` and exact `/diagnostics`, the same command was
run once more.

Result: startup diagnostics passed; three authorized updates were processed;
three replies were sent; the next update offset was acknowledged.

Summary:

- `/diagnostics` routed to the bridge diagnostics reply.
- `/cancel` cleared the previous pending draft.
- A second `/diagnostics` also routed to the bridge diagnostics reply.

After the user sent read-only commands, `live-poll-once` was run with bounded
limit `5`.

Result: startup diagnostics passed; three authorized read-only updates were
processed; three replies were sent; next offset was acknowledged as
expected.

Summary:

- `/today` routed to a bridge reply.
- `/brief` routed to a bridge reply.
- `/reminders` routed to a bridge reply.

The first disposable write attempt was run with the one-shot write opt-in after
the user sent `/add`, `/confirm`, `/complete`, and `/confirm`.

Result: no TickTick write occurred. The `/add` command created an incomplete
draft, both `/confirm` commands returned `invalid`, and `/complete` returned
`complete_candidates`.

The user then refined the pending draft with `today`, confirmed creation, asked
to complete the disposable task, and confirmed completion. `live-poll-once` was
run with:

```text
LIVE_POLL_ONCE_ALLOW_WRITES=true
TELEGRAM_CONFIRM_WRITES=true
TELEGRAM_REQUIRE_PROJECT_FOR_CREATION=false
LIVE_POLL_ONCE_LIMIT=5
```

Result: startup diagnostics passed; four authorized updates were processed;
four replies were sent; writes were explicitly allowed for this one bounded
run; the next update offset was acknowledged.

Summary:

- `today` refined the existing task draft.
- `/confirm` created the disposable TickTick task.
- `/complete test disposable task from telegram` created a pending safe
  completion action.
- `/confirm` completed the disposable TickTick task.
- Local session state had no pending draft, action, or check-in afterward.

```text
git diff --check
```

Result: passed. Git warned that `.gitignore` and `README.md` may be converted
from LF to CRLF when touched by Git on Windows.

```text
rg -n "[ \t]+$" --glob "!output/**" --glob "!.git/**"
```

Result: no trailing whitespace matches.

Secret scan result: no high-confidence Telegram token or secret assignment
patterns found outside ignored/private paths. Two initial false positives were
reviewed and were ordinary `key` variable usage in `command-router.mjs`.

## Privacy Handling

- Telegram token was stored only in ignored local `.env`.
- Remote bridge bearer token was stored only in ignored local `.env`.
- No access token, bearer token, Telegram token, or private task body was
  committed.
- Live readiness printed only redacted secret presence such as `set` or
  `missing`.
- `live-poll-once` prints no message text.

## Remaining Risks

- Live Telegram receive/reply transport is proven.
- Exact live `/diagnostics` bridge-command routing is proven.
- Live `/today`, `/brief`, and `/reminders` bridge-command routing is proven.
- The previous pending draft was cleared through `/cancel`.
- Disposable confirmed create-and-complete writes are proven under explicit
  one-shot opt-in.
- Normal task creation still needs a real default project/list or keyword route
  decision; the disposable write gate used a temporary
  `TELEGRAM_REQUIRE_PROJECT_FOR_CREATION=false` override.
- Proactive, reminder, check-in autonomous loops are still disabled.
- Voice/STT remains disabled.

## Recommended Next Gate

Choose the normal TickTick creation route for future use: configure a default
project/list or explicit keyword routes. After that, decide whether to promote
the bot to a long-running service or continue with local one-shot smoke tests.
Do not enable autonomous loops or voice/STT yet.
