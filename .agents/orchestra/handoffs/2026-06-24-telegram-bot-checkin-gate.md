# Telegram Bot Check-In Gate Handoff

Date: 2026-06-24

## Role And Scope

- Conductor-owned continuation after a subordinate Telegram Bot Agent attempt
  was closed while still running.
- Repo path: `C:\Users\Zoomerland\Documents\TiickTick`.
- Branch: `codex/telegram-bot`.
- Scope: manual check-in gate for the Telegram secretary, without live
  Telegram credentials, TickTick writes, LLM calls, weather, traffic, or STT.

## Agent Coordination

- Agent `019ef7d7-c2e7-7f92-a9da-66cc0d3b8ccf` was assigned the initial
  check-in slice.
- The agent did not return a handoff after two waits and a status request.
- The conductor closed it in `running` state and accepted no agent handoff.
- Useful partial edits visible in the main worktree were reviewed and completed
  by the conductor rather than reverted.

## Files Changed

- `.agents/orchestra/secretary-product-spec.md`
- `.agents/orchestra/roadmap.md`
- `.agents/orchestra/handoffs/2026-06-24-telegram-bot-checkin-gate.md`
- `integrations/telegram-bot/src/secretary/checkin.mjs`
- `integrations/telegram-bot/src/command-router.mjs`
- `integrations/telegram-bot/src/session-store.mjs`
- `integrations/telegram-bot/test/checkin.test.mjs`
- `integrations/telegram-bot/scripts/dry-run.mjs`
- `integrations/telegram-bot/README.md`

## Behavior Added

- `/checkin` calls only read-only bridge tools:
  `ticktick_today` and `ticktick_inbox`.
- The check-in prompt summarizes overdue count, today count, Inbox count,
  untimed today items, near-term timed density, and open-window state when
  available.
- `/checkin` stores a pending check-in context in the existing session store.
- Replies such as `I am on track` acknowledge and clear the check-in without
  bridge writes.
- Replies such as `I am tired` or `leave only the main task` route to the
  existing protected-focus repair draft.
- Replies such as `cancel today` route to the existing all-today repair draft.
- Replies such as `I am late` route to the existing schedule repair draft.
- Schedule-changing replies still create only pending actions and require
  `/confirm` before any TickTick mutation.
- `TELEGRAM_CHECKIN_ENABLED=true` starts an autonomous check-in loop.
- `TELEGRAM_CHECKIN_CHAT_ID` selects the target chat; if unset, the loop can
  fall back to `TELEGRAM_PROACTIVE_CHAT_ID`.
- `TELEGRAM_CHECKIN_INTERVAL_MINUTES` controls loop cadence.
- The check-in loop respects `TELEGRAM_QUIET_HOURS` and
  `TELEGRAM_CHECKIN_HOURS`.
- The loop deduplicates unchanged check-in prompts through `TELEGRAM_STATE_FILE`
  and stores pending check-in context for the target chat after a send.

## Checks Run

Using bundled Node:

```text
node scripts/check.mjs
```

Result: `Checked 51 JavaScript modules.`

```text
node --test --test-reporter=tap test\checkin.test.mjs
```

Result: 5 tests, 5 pass.

```text
node --test --test-reporter=tap test\checkin-scheduler.test.mjs
```

Result: 5 tests, 5 pass.

```text
node --test --test-reporter=tap
```

Result: 115 tests, 115 pass.

```text
node scripts/dry-run.mjs
```

Result: passed; dry-run now demonstrates `/checkin`, `I am tired`, and
`/cancel` before continuing the existing secretary flow.

```text
node scripts/checkin-dry-run.mjs
```

Result: first scheduler run sent one check-in prompt, second identical run
skipped as `duplicate`, and pending check-in state existed for the synthetic
chat.

## Privacy Handling

- No Telegram token used.
- No live Telegram request made.
- No TickTick bearer/OAuth secret printed or written.
- No live TickTick write made.
- No private user task export committed.

## Remaining Risks

- The check-in is deterministic and rule-based; no LLM planning loop is wired.
- Traffic, weather, and calendar context are still absent.
- Live Telegram check-in behavior remains unverified until a bot token and
  allowed user id are configured.

## Recommended Next Gate

Add a no-secret local scheduler smoke for autonomous check-ins, then run live
Telegram `npm run live-readiness` once `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_ALLOWED_USER_IDS` are available.
