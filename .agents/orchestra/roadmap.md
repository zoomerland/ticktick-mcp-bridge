# Telegram Secretary Roadmap

Date: 2026-06-24

## Current Branch

- Branch: `codex/telegram-bot`
- Base commit: `fc8d5caf86eba675443a7d20c88ac7fef7ba2c8c`
- Status: local dirty worktree; no commits or pushes made.
- Unrelated untracked `output/` remains outside this workstream.

## Related MCP/OAuth Workstream

- Remote ChatGPT/self-hosted HTTP MCP OAuth work is not part of this Telegram
  branch.
- Owning worktree:
  `C:\Users\Zoomerland\Documents\TiickTick-chatgpt-oauth`
- Owning branch: `codex/chatgpt-oauth-provider`
- Latest known pushed commit during this coordination refresh: `abbdd9e`
  (`Allow confidential OAuth flow without PKCE`)
- The private VPS may run this branch for live validation, but the Telegram
  branch should treat it as an external bridge endpoint and should not copy
  MCP/OAuth runtime changes into `integrations/`.

## Implemented Gates

- Long-polling Telegram bot skeleton with allowlisted users and rate limits.
- HTTP MCP client for TickTick MCP Bridge.
- Read-only commands for diagnostics, today, overdue, inbox, search, daily
  brief, proactive review, reminders, projects, routes, and profile.
- Confirmed writes for add, complete, and three today-postpone modes.
- Natural Russian and English command aliases for core secretary flows.
- Persistent local state for pending actions, profiles, proactive dedupe, and
  reminder dedupe.
- Proactive and reminder scheduler loops, disabled by default.
- Voice adapter boundary with disabled, mock, and HTTP modes.
- Opt-in Telegram voice download with in-memory bytes and size limits.
- Local STT service boundary with mock and command providers.
- Local STT service `.env.example`, redacted config check, and Windows start
  helper.
- Telegram bot live-readiness preflight that combines redacted config summary,
  remote bridge read-only smoke, and Telegram `getMe` only when live Telegram
  credentials are complete.
- Live Telegram one-shot polling gate with read-only default and explicit
  disposable-write opt-in.
- Disposable confirmed create-and-complete write gate against TickTick.
- Synthetic resource stress gate for the Telegram command router.
- Manual `/checkin` flow that performs read-only day-shape inspection, stores a
  pending check-in context, and routes replies such as "I am tired" or "leave
  only the main task" into confirmed repair drafts.
- Autonomous check-in scheduler, disabled by default, with dry-run coverage,
  quiet-hours/check-in-window checks, duplicate suppression, and pending
  check-in state storage after sending a nudge.
- Local travel-estimate placeholder for appointment/trip drafts: when the user
  does not know duration but provides route context and time of day, the bot can
  attach `TELEGRAM_TRAVEL_DEFAULT_MINUTES + TELEGRAM_TRAVEL_BUFFER_MINUTES`
  without calling weather, traffic, or maps providers.

## Next Gates

1. Choose a normal TickTick creation route: either default project/list or
   keyword-based project routes, so future `/add` flows do not need the
   temporary `TELEGRAM_REQUIRE_PROJECT_FOR_CREATION=false` override.
2. Decide whether the next deployment gate is a long-running Telegram bot
   service or more local one-shot smoke tests.
3. Wire a reviewed local STT executable through `STT_PROVIDER=command`.
4. Run one redacted private voice smoke after explicit approval.

## Blocked Until Private Inputs

- Optional private Telegram chat IDs for proactive/reminder loops.
- Reviewed local STT executable or model runtime.
- Explicit approval before sending private audio through any STT path.

## Latest Accepted Gate

- Protected remote MCP bridge read-only smoke passed through
  `https://<private-mcp-host>/mcp` with bearer auth loaded from the remote
  service environment and not printed or stored locally.
- Result: initialize ok, 40 tools, required tools ok, diagnostics ok,
  `ticktick_today` and `ticktick_inbox` returned counts, no writes called.
- `npm run live-readiness` dry-run also passed against the same protected
  remote bridge using the remote systemd bearer token loaded into process env
  only. Telegram `getMe` was skipped because no Telegram bot token is configured
  yet; no Telegram update polling or messaging call was made.
- A local ignored `integrations/telegram-bot/.env` now exists with Telegram
  credentials, the allowlisted private user id, remote bridge URL, and remote
  bridge bearer token. Secret values are not committed.
- `npm run live-readiness` passed in live Telegram mode: config valid,
  protected bridge read-only smoke passed, Telegram Bot API `getMe` returned
  the expected private bot identity, and no polling or messaging call was made.
- `npm run live-poll-once` is implemented and bounded by update limit. The
  first run passed startup diagnostics and found no pending updates
  (`updateCount: 0`), so the first live reply smoke is still pending.
- A later `npm run live-poll-once` processed three pending authorized updates,
  sent three Telegram replies, and acknowledged the next update offset. This proves
  live Telegram receive/reply transport. The exact diagnostics command still
  needs one more pass because the received command was `/diagnostic`, which is
  not the implemented `/diagnostics` command.
- The exact diagnostics gate then passed: `npm run live-poll-once` processed
  `/diagnostics`, `/cancel`, and another `/diagnostics` from the allowlisted
  user; both diagnostics updates were routed as bridge replies, all three
  replies were sent, and the next update offset was acknowledged.
- Live read-only command gate passed: `npm run live-poll-once` processed
  `/today`, `/brief`, and `/reminders` from the allowlisted user; all three were
  routed as bridge replies, all three replies were sent, and offset
  the next update offset was acknowledged.
- Disposable confirmed-write gate passed. `npm run live-poll-once` was run with
  explicit one-shot write opt-in (`LIVE_POLL_ONCE_ALLOW_WRITES=true` and
  `TELEGRAM_CONFIRM_WRITES=true`) plus temporary
  `TELEGRAM_REQUIRE_PROJECT_FOR_CREATION=false`. It processed the user's
  pending disposable draft refinement, `/confirm`, `/complete`, and final
  `/confirm`; the results were `task_draft`, `created_task`, `complete_draft`,
  and `completed_task`, all replies were sent, the next update offset was
  acknowledged, and local pending state was clear afterward.
- Synthetic resource stress passed without external Telegram or TickTick calls.
  A 100,000-update run through the real command router completed in 1.97s
  wall time, averaged about 50.8k updates/s, reported p95 latency 0.062ms and
  p99 0.115ms, peaked at 54.18 MiB RSS and 11.36 MiB heap used, and ended after
  final GC at +14.46 MiB RSS / +1.69 MiB heap. Session pending state was clear
  afterward.
- `/checkin` gate passed locally with synthetic bridge data. It uses only
  `ticktick_today` and `ticktick_inbox` for the prompt, and any reply that would
  change the schedule creates a pending action requiring `/confirm`.
- `npm run checkin-dry-run` passed locally. First run sends one check-in prompt,
  the second identical run skips as duplicate, and no Telegram or TickTick live
  credentials are used.
- Travel planning gate passed locally. A travel draft that receives "I don't
  know, from home to clinic" asks for time of day; after "at 09:00" it adds a
  local 60-minute estimate and remains a confirmed `/confirm` write flow.
