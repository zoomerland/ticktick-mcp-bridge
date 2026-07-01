# TickTick Telegram Bot

Local-first Telegram secretary service for TickTick MCP Bridge.

The first slice is intentionally narrow:

- long polling;
- read-only commands;
- allowlisted Telegram users;
- HTTP MCP client to the existing TickTick MCP Bridge;
- no live startup without a Telegram token and allowed user IDs;
- dry-run tests without secrets.

## Commands

- `/start`
- `/diagnostics`
- `/checkin`
- `/brief`
- `/proactive`
- `/today`
- `/overdue`
- `/projects`
- `/inbox`
- `/search <query>`
- `/add <task text>`
- `/complete <task query>`
- `/postpone-today tomorrow`
- `/postpone-today all tomorrow`
- `/postpone-today rest tomorrow`
- `/profile`
- `/routes`
- `/set-sleep 23-8`
- `/set-checkins 9-21`
- `/set-reminder-lead 30`
- `/set-route keyword=projectId`
- `/reminders`
- `/capture <task text>`

Write commands create a pending action first and mutate TickTick only after
`/confirm`.

Plain non-command text is treated as a task draft and may produce clarifying
questions instead of writing to TickTick.

Optional LLM mode can be enabled with `TELEGRAM_LLM_ENABLED=true`. It does not
talk to TickTick directly. Instead, it has two internal modes:

- chat mode: a warmer planning conversation that does not call the bridge;
- executor mode: strict JSON planning that maps a message to one existing bot
  command, then reuses this router and its `/confirm` safety gates.

The default local model is `qwen3:14b` through Ollama. The strict executor path
uses JSON mode, no-thinking mode, temperature `0`, a fixed command allowlist,
and fail-closed behavior. If the model is unavailable or returns an unsafe
shape, the bot asks the user to use deterministic slash commands instead of
guessing.
The LLM executor is not allowed to emit `confirm`; write execution still
requires the literal `/confirm` command.
The default LLM timeout is `120000` ms to survive a cold local Ollama model
load; warm executor calls should be much faster.
OpenAI can be selected with `TELEGRAM_LLM_PROVIDER=openai`, but it requires an
explicit API key and model. See [LLM dev-live roadmap](docs/LLM_DEV_LIVE_ROADMAP.md)
for the provider and confirmation plan.

### LLM Chat Test

Use the local chat harness to talk to the selected model without starting
Telegram polling:

```powershell
npm run llm-chat
```

The harness forces `TELEGRAM_DRY_RUN=true`, enables LLM mode, and uses a mock
TickTick bridge by default. It is safe for quick conversation and executor
planning checks. To point it at a forwarded local Ollama endpoint:

```powershell
$env:TELEGRAM_LLM_OLLAMA_URL = "http://127.0.0.1:11435"
$env:TELEGRAM_LLM_MODEL = "qwen3:14b"
npm run llm-chat
```

Use `TELEGRAM_LLM_CHAT_BRIDGE=live` only for an explicit live MCP smoke.
Confirmed writes stay disabled unless `TELEGRAM_LLM_CHAT_ALLOW_WRITES=true` is
also set.

When a pending travel or appointment draft asks for missing details, replies
such as `30 minutes`, `полчаса`, or `от дома до клиники` are captured into the
draft and shown back under `captured details`. This is deterministic parsing
only; traffic, weather, and live route-time providers are not implemented yet.
Simple due hints are also deterministic: `today`, `сегодня`, `tomorrow`,
`завтра`, and `HH:mm` are shown in the draft and passed to TickTick as
`dueDate`, `isAllDay`, and `timeZone` only after `/confirm`.
If the user says they do not know a travel duration, then provides route
context and a time of day, the bot can attach a local estimate using
`TELEGRAM_TRAVEL_DEFAULT_MINUTES + TELEGRAM_TRAVEL_BUFFER_MINUTES`. This is a
deterministic placeholder and explicitly does not check weather or traffic yet.

Clear read-only phrases are routed as secretary intents instead of task drafts,
for example:

- `что у меня сегодня`
- `какой план на сегодня`
- `что дальше`
- `что просрочено`
- `что в инбоксе`
- `чем заняться`

Russian slash aliases are also supported for the stable command surface, such as
`/сегодня`, `/план`, `/напоминания`, `/поиск`, `/профиль`, `/маршруты`, and
`/отмена`.

`/checkin` performs only read-only bridge calls, summarizes the current day
shape, asks one practical question, and stores a pending check-in context.
Replies such as `I am on track`, `I am tired`, `leave only the main task`, or
`cancel today` are routed into safe secretary flows. Any schedule-changing reply
still creates only a pending repair action and waits for `/confirm`.

Natural schedule-repair choices such as `move today's lower priority tasks
tomorrow` are converted into the same pending repair action as
`/postpone-today tomorrow`; TickTick is still not changed until `/confirm`.
Broader cancellation phrases such as `cancel today's plans` create an all-today
postpone draft equivalent to `/postpone-today all tomorrow`; this still requires
`/confirm`.
Protected-focus phrases such as `keep only the highest-priority item and
reschedule the rest` or `оставь главное, перенеси остальное на завтра` create a
pending repair draft equivalent to `/postpone-today rest tomorrow`. Tied
top-priority tasks are kept; lower-priority today tasks move only after
`/confirm`.

Project routing rules keep recurring task types out of Inbox. Use
`/set-route doctor=project-health` or
`/set-route doctor=project-health|Health` after you know the target TickTick
project ID. `/projects` lists TickTick project/list IDs, including Inbox when
the bridge returns it. `/routes` shows effective profile and `.env` routes.
Profile routes take priority over `TELEGRAM_PROJECT_ROUTES`.

Voice messages are recognized. By default no file is downloaded and no
transcription runs. `TELEGRAM_VOICE_PROVIDER=mock` is available only as a safe
adapter gate: it routes `TELEGRAM_VOICE_MOCK_TRANSCRIPT` through the same text
planning flow without downloading Telegram audio.

`TELEGRAM_VOICE_PROVIDER=http` defines the future local STT service boundary.
It posts explicit audio payloads as JSON/base64 to `TELEGRAM_VOICE_HTTP_URL`;
live Telegram audio download remains disabled unless
`TELEGRAM_VOICE_DOWNLOAD_ENABLED=true`. Downloaded voice files are kept in
memory only and rejected above `TELEGRAM_VOICE_MAX_BYTES`.
The companion service skeleton is in `../local-stt-service/`; it currently
ships only a mock provider for boundary validation.

`/set-sleep 23-8` stores per-user quiet hours in the local state file. Proactive
reviews use that profile setting when present.

`/set-checkins 9-21` stores when the secretary may proactively start non-urgent
check-ins. Proactive review still respects quiet hours first.

`/set-reminder-lead 30` stores how early the secretary should warn about dated
tasks. `/reminders` shows tasks inside that lead window.

Plain text that looks like a schedule disruption, for example "I am late" or
"cancel today's plans", produces a schedule repair draft using today's TickTick
tasks. It does not mutate TickTick until a later confirmed repair flow exists.

`/postpone-today tomorrow` proposes moving non-high-priority tasks due today to
tomorrow. `/postpone-today all tomorrow` proposes moving all tasks due today to
tomorrow. `/postpone-today rest tomorrow` keeps the top-priority today task or
tied top-priority tasks and proposes moving the rest to tomorrow. All three wait
for `/confirm`.

When `TELEGRAM_PROACTIVE_ENABLED=true`, the service also runs a periodic
proactive review loop and sends useful nudges to `TELEGRAM_PROACTIVE_CHAT_ID`.
It respects `TELEGRAM_QUIET_HOURS` and deduplicates unchanged review states.

When `TELEGRAM_REMINDERS_ENABLED=true`, the service also runs a periodic
reminder loop and sends upcoming task reminders to `TELEGRAM_REMINDER_CHAT_ID`.
Already sent task/due-time reminders are deduplicated in the state file.

Pending actions, proactive dedupe state, and profile settings are persisted in
`TELEGRAM_STATE_FILE` (`data/telegram-state.json` by default). The `data/`
directory is ignored by Git.

## Local Checks

```powershell
cd integrations/telegram-bot
npm run check
npm test
npm run dry-run
npm run proactive-dry-run
npm run checkin-dry-run
npm run reminder-dry-run
npm run llm-chat
npm run voice-dry-run
npm run voice-http-dry-run
npm run voice-local-stt-dry-run
npm run resource-stress
```

`resource-stress` is local and synthetic. It does not call Telegram or TickTick;
it runs many mock updates through the real command router and reports wall time,
CPU, latency, reply kinds, bridge call counts, and memory deltas.

## Live Configuration

Create `.env` from `.env.example` or provide the same variables through the
service manager.

Required for live polling:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS`

Useful local profile/runtime settings:

- `TELEGRAM_STATE_FILE`
- `TELEGRAM_QUIET_HOURS`
- `TELEGRAM_CHECKIN_ENABLED=false`
- `TELEGRAM_CHECKIN_CHAT_ID`
- `TELEGRAM_CHECKIN_INTERVAL_MINUTES`
- `TELEGRAM_CHECKIN_HOURS`
- `TELEGRAM_REMINDER_LEAD_MINUTES`
- `TELEGRAM_TRAVEL_DEFAULT_MINUTES`
- `TELEGRAM_TRAVEL_BUFFER_MINUTES`
- `TELEGRAM_PROJECT_ROUTES`, for example `doctor=project-health;work=project-work`
- `TELEGRAM_VOICE_ENABLED=true`, `TELEGRAM_VOICE_PROVIDER=mock`, and
  `TELEGRAM_VOICE_MOCK_TRANSCRIPT` for adapter dry-runs only
- `TELEGRAM_VOICE_PROVIDER=http`, `TELEGRAM_VOICE_HTTP_URL`, and
  `TELEGRAM_VOICE_HTTP_TOKEN` for the local STT service boundary
- `TELEGRAM_VOICE_DOWNLOAD_ENABLED=true` and `TELEGRAM_VOICE_MAX_BYTES` only
  after the local STT service is ready
- `TELEGRAM_LLM_ENABLED=false` to keep LLM mode opt-in
- `TELEGRAM_LLM_PROVIDER=ollama`, or `openai` for an OpenAI-backed provider
- `TELEGRAM_LLM_OLLAMA_URL=http://127.0.0.1:11434`
- `TELEGRAM_LLM_OPENAI_API_KEY` or `OPENAI_API_KEY` for OpenAI mode
- `TELEGRAM_LLM_OPENAI_MODEL` for OpenAI mode
- `TELEGRAM_LLM_MODEL=qwen3:14b`
- `TELEGRAM_LLM_TIMEOUT_MS=120000`
- `TELEGRAM_LLM_ROUTER_MODEL`, `TELEGRAM_LLM_EXECUTOR_MODEL`, and
  `TELEGRAM_LLM_CHAT_MODEL` when the two modes should use different models
- `TELEGRAM_LLM_FAIL_CLOSED=true` so unsafe model output does not become a task
  draft by accident
- `TELEGRAM_CONFIRM_WRITES=false` for the first read-only live smoke

Bridge defaults to local MCP HTTP:

```text
TICKTICK_MCP_URL=http://127.0.0.1:8787/mcp
```

If the bot talks to a public bridge URL, set `TICKTICK_MCP_BEARER_TOKEN`.

Before live startup, run `npm run config-check`. It prints only a redacted
configuration summary and fails closed when the Telegram token or user allowlist
is missing.

`TELEGRAM_CHECKIN_ENABLED=true` starts the autonomous check-in loop. Keep it
disabled until manual `/checkin` works in live Telegram. The loop sends to
`TELEGRAM_CHECKIN_CHAT_ID`, or falls back to `TELEGRAM_PROACTIVE_CHAT_ID`; it
respects quiet hours and `TELEGRAM_CHECKIN_HOURS`.

## Bridge Read-Only Smoke

Before starting Telegram polling, verify the MCP bridge without requiring a
Telegram token:

```powershell
npm run bridge-readonly-smoke
```

This script reads `.env`, forces Telegram dry-run mode for the smoke itself, and
performs only read-only MCP calls. It reports counts and secret presence, not
token values or task bodies.

## Live Readiness Preflight

After `config-check` and `bridge-readonly-smoke`, run the combined preflight:

```powershell
npm run live-readiness
```

It reads `.env`, prints the same redacted configuration summary, runs the
read-only bridge smoke, and only calls Telegram Bot API `getMe` when a bot token
is configured and the live Telegram config is otherwise valid. It does not call
`getUpdates`, `sendMessage`, or polling. Missing live token or allowlist values
fail closed with next steps, while `TELEGRAM_DRY_RUN=true` can still be used for
no-token bridge readiness checks.

After that, send `/diagnostics` from the allowlisted private Telegram user and
run one bounded live poll:

```powershell
npm run live-poll-once
```

That script keeps confirmed writes off by default, forces autonomous loops off,
processes only a small limited batch of updates, sends normal command replies,
acknowledges the processed offset, and prints only a redacted summary. For a
disposable write gate, both `LIVE_POLL_ONCE_ALLOW_WRITES=true` and
`TELEGRAM_CONFIRM_WRITES=true` must be set for that one run.

See [deployment notes](docs/DEPLOYMENT.md) for local Windows and VPS service
shapes.

## Security

Do not commit `.env`, Telegram tokens, TickTick tokens, bearer secrets, chat IDs,
raw task exports, or private logs.
