# Telegram Bot Confirmation And Proactive Handoff

Date: 2026-06-24

## Role And Scope

- Conductor-owned continuation for the Telegram secretary implementation.
- Repo path: `C:\Users\Zoomerland\Documents\TiickTick`.
- Branch: `codex/telegram-bot`.
- Scope: stateful task confirmation, proactive review loop, and safe schedule
  repair drafts.

## Files Changed

- `integrations/telegram-bot/src/session-store.mjs`
- `integrations/telegram-bot/src/secretary/capture.mjs`
- `integrations/telegram-bot/src/secretary/proactive.mjs`
- `integrations/telegram-bot/src/secretary/repair.mjs`
- `integrations/telegram-bot/src/proactive-scheduler.mjs`
- `integrations/telegram-bot/src/command-router.mjs`
- `integrations/telegram-bot/src/config.mjs`
- `integrations/telegram-bot/src/index.mjs`
- `integrations/telegram-bot/scripts/dry-run.mjs`
- `integrations/telegram-bot/scripts/proactive-dry-run.mjs`
- `integrations/telegram-bot/test/*.mjs`
- `integrations/telegram-bot/.env.example`
- `integrations/telegram-bot/README.md`
- `integrations/telegram-bot/docs/DEPLOYMENT.md`

## Behavior Added

- Pending task drafts are stored per session.
- `/add <text>` and `/capture <text>` create pending drafts.
- Plain text can refine an existing pending draft.
- `/confirm` writes through `ticktick_create_task` only when the draft is
  complete.
- `/confirm` refuses incomplete drafts without calling the bridge.
- `/cancel` clears the pending draft.
- `/proactive` runs a manual proactive review.
- `TELEGRAM_PROACTIVE_ENABLED=true` enables a periodic proactive loop.
- `TELEGRAM_PROACTIVE_CHAT_ID` selects the chat for proactive nudges.
- `TELEGRAM_QUIET_HOURS` suppresses non-urgent proactive nudges.
- Proactive nudges deduplicate unchanged review states.
- Schedule disruption text such as "I am late" or "я не успеваю" produces a
  schedule repair draft without writing to TickTick.

## Checks Run

Using bundled Node:

```text
C:\Users\Zoomerland\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts\check.mjs
```

Result: `Checked 26 JavaScript modules.`

```text
C:\Users\Zoomerland\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test
```

Result: 31 tests, 31 pass.

```text
C:\Users\Zoomerland\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts\dry-run.mjs
```

Result: dry-run covers help, diagnostics, brief, proactive review, schedule
repair, doctor-trip clarification, search, add draft, and protected confirm.

```text
C:\Users\Zoomerland\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts\proactive-dry-run.mjs
```

Result: proactive dry-run returns `shouldNotify: true` with reason counters.

## Privacy Handling

- No Telegram token used.
- No live Telegram request made.
- No TickTick bearer/OAuth secret used.
- No live TickTick write made.
- No task export or private log committed.

## Continuation Update

Added after the first confirmation/proactive pass:

- `/complete <task query>` searches candidates with
  `ticktick_find_task_candidates`.
- `/complete` stores a pending completion only when the bridge says it can act
  on one safe candidate.
- `/confirm` completes that task through `ticktick_complete_task_safe`.
- Ambiguous `/complete` results show candidates and do not store a pending
  action.
- `/postpone-today tomorrow` proposes moving non-high-priority tasks due today
  to tomorrow.
- `/confirm` for that repair action calls `ticktick_update_task` for each
  selected task.
- Voice messages are recognized and handled with a safe "transcription not
  enabled" response; no file is downloaded and no STT provider is invoked.

Latest checks:

- `node scripts/check.mjs`: `Checked 28 JavaScript modules.`
- `node --test`: 37 tests, 37 pass.
- `node scripts/dry-run.mjs`: covers help, diagnostics, brief, proactive review,
  schedule repair, doctor-trip clarification, search, confirmed complete,
  confirmed postpone-today, add draft, and protected confirm.
- `node scripts/proactive-dry-run.mjs`: returns `shouldNotify: true` with reason
  counters.

No live Telegram call, live TickTick write, token use, or secret write happened
in this continuation.

## Persistence And Profile Update

Added after completion/repair/voice work:

- `TELEGRAM_STATE_FILE` stores pending drafts/actions, proactive dedupe state,
  and user profile data in JSON.
- `FileSessionStore` persists state under `data/telegram-state.json` by default.
- `integrations/telegram-bot/data/` is ignored by Git.
- `/profile` shows current quiet hours, reminder lead, and timezone.
- `/set-sleep 23-8` stores per-user quiet hours.
- `/set-reminder-lead 30` stores per-user reminder lead time.
- `/reminders` shows tasks with due/start time inside the configured lead
  window.

Latest checks after persistence/profile/reminders:

- `node scripts/check.mjs`: `Checked 34 JavaScript modules.`
- `node --test`: 45 tests, 45 pass.
- `node scripts/dry-run.mjs`: shows profile, sleep setting, reminder lead,
  reminders, proactive review, confirmed complete, confirmed postpone-today,
  and protected add confirmation.

## Autonomous Reminder Loop Update

Added after persistence/profile/reminders:

- `src/reminder-scheduler.mjs` runs a periodic reminder loop when
  `TELEGRAM_REMINDERS_ENABLED=true`.
- `TELEGRAM_REMINDER_CHAT_ID` selects the target chat; if unset, the loop falls
  back to `TELEGRAM_PROACTIVE_CHAT_ID`.
- `TELEGRAM_REMINDER_INTERVAL_MINUTES` controls the loop interval.
- Reminder dedupe is keyed by task id/title plus due/start timestamp and is
  persisted in `TELEGRAM_STATE_FILE`.
- Reminder messages are rebuilt after dedupe, so already-sent task instances are
  not repeated in a partially filtered reminder message.
- `scripts/reminder-dry-run.mjs` exercises one send plus one duplicate skip.
- `scripts/config-check.mjs` validates live startup configuration and prints
  only redacted secret presence flags.

Latest checks after autonomous reminder loop:

- `node scripts/check.mjs`: `Checked 38 JavaScript modules.`
- `node scripts/config-check.mjs` with dummy live env: valid startup summary,
  secret values redacted.
- `node --test --test-reporter=tap`: 49 tests, 49 pass, 0 fail.
- `node scripts/dry-run.mjs`: covers help, diagnostics, profile, sleep/reminder
  profile updates, brief, proactive, reminders, schedule repair, capture,
  search, confirmed complete, confirmed postpone-today, and protected add
  confirmation.
- `node scripts/proactive-dry-run.mjs`: returns `shouldNotify: true` with reason
  counters.
- `node scripts/reminder-dry-run.mjs`: first reminder send succeeds, second run
  skips as `duplicate`, and only one Telegram message is emitted.
- `git diff --check`: no whitespace errors; Git reports local LF-to-CRLF
  warnings for `.gitignore` and `README.md`.
- Secret scan over tracked/untracked project files excluding `.git`, `output/`,
  and `*.local.md`: no matches for known VPS/domain/OAuth secret patterns.

## Independent Review Fixes

Lovelace reviewed this slice as Telegram Bot Agent and found two live-smoke
blockers plus one medium dedupe issue. Fixed after review:

- `TELEGRAM_CONFIRM_WRITES=false` now blocks every `/confirm` write path before
  `ticktick_create_task`, `ticktick_complete_task_safe`, or
  `ticktick_update_task` can be called.
- `pollOnce` now catches per-update failures, sends a sanitized failure reply
  when possible, logs the internal error, and still returns the advanced
  Telegram offset.
- Proactive dedupe now includes a hash of the review text in the signature, so
  changed top-task content with identical counters is not suppressed. The state
  file stores only the hash, not task text.

Latest checks after review fixes:

- `node scripts/check.mjs`: `Checked 39 JavaScript modules.`
- `node scripts/config-check.mjs` with dummy live env: valid startup summary,
  secret values redacted.
- `node --test --test-reporter=tap`: 52 tests, 52 pass, 0 fail.
- `node scripts/dry-run.mjs`: passed the same mocked secretary command flow.
- `node scripts/proactive-dry-run.mjs`: returns `shouldNotify: true` with reason
  counters.
- `node scripts/reminder-dry-run.mjs`: first reminder send succeeds, second run
  skips as `duplicate`, and only one Telegram message is emitted.

## Natural Intent Update

Added after review fixes:

- `src/secretary/intents.mjs` maps stable English/Russian slash aliases to the
  existing command surface.
- Clear read-only Russian phrases now route to the secretary view instead of
  creating accidental task drafts, for example "что у меня сегодня",
  "что дальше", "что просрочено", and "чем заняться".
- Pending task drafts still take precedence over natural read-only intents, so
  short answers such as "сегодня" continue to refine the draft instead of
  triggering `/today`.
- Exact natural cancellation phrases such as "отмена" clear pending state.
- `scripts/dry-run.mjs` now covers natural Russian day/reminder phrases and the
  `/сегодня` alias.

Latest checks after natural intent update:

- `node scripts/check.mjs`: `Checked 40 JavaScript modules.`
- `node --test --test-reporter=tap`: 57 tests, 57 pass, 0 fail.
- `node scripts/dry-run.mjs`: passed and shows natural Russian phrases routing
  to today/reminder output.
- `node scripts/proactive-dry-run.mjs`: passed.
- `node scripts/reminder-dry-run.mjs`: passed.

## Project Routing Update

Added after natural intent update:

- `TELEGRAM_PROJECT_ROUTES` supports static route rules such as
  `doctor=project-health;work=project-work`.
- `/set-route keyword=projectId` and `/set-route keyword=projectId|Project Name`
  store profile-level route rules in `TELEGRAM_STATE_FILE`.
- `/routes` shows effective profile and environment route rules.
- Profile-level routes take priority over `.env` routes.
- Task drafts now match route keywords and include `projectId` in
  `ticktick_create_task` args after `/confirm`.
- A routed draft no longer asks "Which TickTick list/project should this go to?"
  when `TELEGRAM_REQUIRE_PROJECT_FOR_CREATION=true`.
- `scripts/config-check.mjs` reports the route count without printing route
  values.

Latest checks after project routing:

- `node scripts/check.mjs`: `Checked 40 JavaScript modules.`
- `node scripts/config-check.mjs` with dummy live env and two project routes:
  valid startup summary, `projectRoutes: 2`, secret values redacted.
- `node --test --test-reporter=tap`: 61 tests, 61 pass, 0 fail.
- `node scripts/dry-run.mjs`: passed and shows `/set-route`, `/routes`, routed
  Russian doctor task draft, and routed English doctor task draft.
- `node scripts/proactive-dry-run.mjs`: passed.
- `node scripts/reminder-dry-run.mjs`: passed.

## Check-In Window Update

Added after project routing:

- `TELEGRAM_CHECKIN_HOURS` defines the default initiative window, `9-21` by
  default.
- `/set-checkins 9-21` stores a per-user proactive check-in window in
  `TELEGRAM_STATE_FILE`.
- `/profile` reports effective quiet hours and check-in hours separately.
- `applyProfileToConfig` applies both sleep/quiet hours and check-in hours.
- Proactive review now includes `inCheckinHours` in its reasons and suppresses
  non-urgent proactive notifications outside the configured check-in window.
- Proactive dedupe includes the check-in-window state in its signature.
- `scripts/config-check.mjs` reports the effective check-in window.

Latest checks after check-in window:

- `node scripts/check.mjs`: `Checked 40 JavaScript modules.`
- `node scripts/config-check.mjs` with dummy live env, two routes, and
  `TELEGRAM_CHECKIN_HOURS=10-20`: valid startup summary, `checkinHours: 10-20`,
  secret values redacted.
- `node --test --test-reporter=tap`: 65 tests, 65 pass, 0 fail.
- `node scripts/dry-run.mjs`: passed and shows `/set-checkins`, profile
  check-in hours, and proactive check-in-window note.
- `node scripts/proactive-dry-run.mjs`: passed and includes `inCheckinHours`.
- `node scripts/reminder-dry-run.mjs`: passed.

## Natural Schedule Repair Choice Update

Added after check-in window:

- Natural phrases such as `move today's lower priority tasks tomorrow` now
  create the same pending repair action as `/postpone-today tomorrow`.
- The action still requires `/confirm`; no TickTick write occurs when the
  natural repair phrase is received.
- `/cancel` clears the pending natural repair action.
- `scripts/dry-run.mjs` now covers the natural repair choice plus cancellation.

Latest checks after natural schedule repair choice:

- `node scripts/check.mjs`: `Checked 40 JavaScript modules.`
- `node --test --test-reporter=tap`: 67 tests, 67 pass, 0 fail.
- `node scripts/dry-run.mjs`: passed and shows the natural repair phrase
  creating a pending postpone draft without writing.
- `node scripts/proactive-dry-run.mjs`: passed.
- `node scripts/reminder-dry-run.mjs`: passed.

## Voice Adapter Gate Update

Added after natural schedule repair choice:

- `TELEGRAM_VOICE_MOCK_TRANSCRIPT` is parsed but never printed by
  `config-check`.
- `TELEGRAM_VOICE_PROVIDER=mock` provides a safe adapter gate: the configured
  transcript is routed through the same `routeText` planning flow.
- The mock voice gate does not download Telegram voice files and does not invoke
  a real STT provider.
- Disabled voice behavior remains fail-closed and asks the user to send text.
- `scripts/voice-dry-run.mjs` exercises an authorized synthetic voice update,
  mock transcript routing, and reminder output.

Latest checks after voice adapter gate:

- `node scripts/check.mjs`: `Checked 42 JavaScript modules.`
- `node scripts/config-check.mjs` with dummy live env and mock voice transcript:
  valid startup summary, `voiceMockTranscript: set`, transcript value redacted.
- `node --test --test-reporter=tap`: 72 tests, 72 pass, 0 fail.
- `node scripts/dry-run.mjs`: passed.
- `node scripts/proactive-dry-run.mjs`: passed.
- `node scripts/reminder-dry-run.mjs`: passed.
- `node scripts/voice-dry-run.mjs`: passed and routes mock voice transcript to
  upcoming reminders without downloading audio.

## HTTP STT Boundary Update

Added after voice adapter gate:

- `TELEGRAM_VOICE_PROVIDER=http` defines a future local STT service boundary.
- `TELEGRAM_VOICE_HTTP_URL`, `TELEGRAM_VOICE_HTTP_TOKEN`, and
  `TELEGRAM_VOICE_HTTP_TIMEOUT_MS` configure that boundary.
- `TELEGRAM_VOICE_DOWNLOAD_ENABLED=false` remains the default; live Telegram
  audio download is not implemented in this slice.
- The HTTP provider fails closed when no explicit audio payload is supplied, so
  live Telegram voice updates do not download files or call STT by accident.
- When an explicit synthetic audio payload is supplied in tests/dry-run, the
  provider posts JSON/base64 to the configured HTTP endpoint and routes the
  returned transcript through `routeText`.
- `scripts/voice-http-dry-run.mjs` validates the HTTP adapter boundary with a
  mocked fetch implementation; it starts no server and reads no private audio.

Latest checks after HTTP STT boundary:

- `node scripts/check.mjs`: `Checked 43 JavaScript modules.`
- `node scripts/config-check.mjs` with dummy live env and HTTP voice provider:
  valid startup summary, URL/token presence shown as set, values redacted.
- `node --test --test-reporter=tap`: 75 tests, 75 pass, 0 fail.
- `node scripts/dry-run.mjs`: passed.
- `node scripts/proactive-dry-run.mjs`: passed.
- `node scripts/reminder-dry-run.mjs`: passed.
- `node scripts/voice-dry-run.mjs`: passed.
- `node scripts/voice-http-dry-run.mjs`: passed, mocked HTTP request sent, auth
  header present, synthetic audio bytes encoded, transcript routed to reminders.

## Opt-In Telegram Voice Download Update

Added after HTTP STT boundary:

- `TELEGRAM_VOICE_DOWNLOAD_ENABLED=false` remains the default.
- `TELEGRAM_VOICE_MAX_BYTES` limits accepted Telegram voice files before and
  after download.
- `TelegramClient.getFile` and `TelegramClient.downloadFileBytes` implement the
  Telegram file API path.
- `downloadVoiceAudio` keeps voice bytes in memory only and never writes audio
  to disk.
- `handleUpdate` passes the Telegram client into voice handling; the download
  path is used only for `TELEGRAM_VOICE_PROVIDER=http` with
  `TELEGRAM_VOICE_DOWNLOAD_ENABLED=true`.
- If download is disabled, too large, or unavailable, voice handling fails
  closed and no STT request is made.
- `scripts/voice-http-dry-run.mjs` now validates the full mocked chain:
  Telegram getFile, Telegram file download, HTTP STT request, transcript routing.

Latest checks after opt-in Telegram voice download:

- `node scripts/check.mjs`: `Checked 43 JavaScript modules.`
- `node scripts/config-check.mjs` with dummy live env, HTTP voice provider,
  download enabled, and max bytes: valid startup summary, URL/token values
  redacted.
- `node --test --test-reporter=tap`: 80 tests, 80 pass, 0 fail.
- `node scripts/dry-run.mjs`: passed.
- `node scripts/proactive-dry-run.mjs`: passed.
- `node scripts/reminder-dry-run.mjs`: passed.
- `node scripts/voice-dry-run.mjs`: passed.
- `node scripts/voice-http-dry-run.mjs`: passed, Telegram downloader mock called,
  HTTP request sent, auth header present, synthetic audio bytes encoded,
  transcript routed to reminders.

## Local STT Service Skeleton Update

Added after opt-in Telegram voice download:

- `integrations/local-stt-service/` defines the local HTTP STT service boundary
  for Telegram voice transcription.
- The service exposes `GET /health` and `POST /transcribe`.
- `STT_PROVIDER=mock` returns `STT_MOCK_TRANSCRIPT` for contract validation.
- Missing audio, oversized audio, missing mock transcript, and unknown provider
  states fail closed.
- No real STT runtime, private audio corpus, model download, or model artifact
  is included in this repository.
- The Telegram bot documentation now points `TELEGRAM_VOICE_PROVIDER=http` at
  this companion service as the next voice gate.
- `integrations/telegram-bot/scripts/voice-local-stt-dry-run.mjs` starts the
  local STT service on loopback, sends a synthetic Telegram voice update through
  the bot HTTP voice adapter, and closes the service after the smoke.

Latest checks after local STT service skeleton:

- `local-stt-service`: `node scripts/check.mjs` checked 7 JavaScript modules.
- `local-stt-service`: `node --test --test-reporter=tap` passed 4 tests.
- `local-stt-service`: `node scripts/dry-run.mjs` returned a mock transcript
  response with 3 audio bytes.
- `telegram-bot`: `node scripts/check.mjs` checked 44 JavaScript modules.
- `telegram-bot`: `node scripts/config-check.mjs` with dummy HTTP voice env
  returned a valid startup summary with secret values redacted.
- `telegram-bot`: `node --test --test-reporter=tap` passed 80 tests.
- `telegram-bot`: `node scripts/dry-run.mjs` passed the secretary command flow.
- `telegram-bot`: `node scripts/proactive-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/reminder-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-http-dry-run.mjs` passed with mocked
  HTTP provider.
- `telegram-bot`: `node scripts/voice-local-stt-dry-run.mjs` passed with a real
  loopback local STT service instance and synthetic Telegram voice bytes.

## Independent Agent Review And Fixes

Two subordinate agents reviewed the branch:

- Telegram Bot Agent found stale mixed pending-state risk and voice/STT live
  hardening gaps.
- TickTick MCP Bridge Agent found no MCP contract blockers: all Telegram bot
  tool names and argument shapes match the existing bridge schemas.

Fixes after review:

- `SessionStore.setPendingTaskDraft` now clears any older pending action.
- `SessionStore.setPendingAction` now clears any older pending task draft.
- Mixed pending-state regression tests cover draft-after-action and
  action-after-draft flows.
- `TELEGRAM_CONFIRM_WRITES` now defaults to `false`; write-capable dry-runs opt
  in explicitly.
- `.env.example` now starts with `TELEGRAM_CONFIRM_WRITES=false`.
- `TelegramClient.downloadFileBytes` accepts a max byte limit, rejects known
  oversized downloads before reading the body, and enforces the same limit while
  streaming response bytes when the runtime exposes a stream reader.
- `downloadVoiceAudio` passes `TELEGRAM_VOICE_MAX_BYTES` into Telegram file
  download.
- `local-stt-service` supports optional `STT_BEARER_TOKEN`; when configured,
  `POST /transcribe` requires `Authorization: Bearer <token>`.
- The bot-to-local-STT dry-run now starts the local STT service with a dummy
  bearer token and exercises the authenticated path.

Latest checks after independent review fixes:

- `telegram-bot`: `node scripts/check.mjs` checked 44 JavaScript modules.
- `telegram-bot`: `node --test --test-reporter=tap` passed 83 tests.
- `telegram-bot`: `node scripts/dry-run.mjs` passed.
- `telegram-bot`: `node scripts/proactive-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/reminder-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-http-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-local-stt-dry-run.mjs` passed.
- `local-stt-service`: `node scripts/check.mjs` checked 7 JavaScript modules.
- `local-stt-service`: `node --test --test-reporter=tap` passed 5 tests.
- `local-stt-service`: `node scripts/dry-run.mjs` passed.

## Schedule Shape Proactive Update

Added after independent review fixes:

- `analyzeScheduleShape` inspects today's tasks for timed items, untimed items,
  near-term density, high-priority load, and the gap before the next timed task.
- Proactive review now mentions large open windows before the next timed task.
- Proactive review now flags dense near-term schedules when three timed items
  are due in the next two hours.
- Proactive review now surfaces untimed today items so the bot can ask when they
  should happen.
- Proactive review suppresses duplicate display when the same task is both the
  high-priority top item and the next timed item.
- No TickTick writes, external calendar calls, weather calls, traffic calls, or
  LLM planner dependency were added in this gate.

Latest targeted checks after schedule shape update:

- `telegram-bot`: `node --test --test-reporter=tap test/proactive.test.mjs
  test/proactive-scheduler.test.mjs` passed 11 tests.
- `telegram-bot`: `node scripts/proactive-dry-run.mjs` passed and includes the
  expanded reason counters.

Latest full checks after schedule shape update:

- `telegram-bot`: `node scripts/check.mjs` checked 44 JavaScript modules.
- `telegram-bot`: `node --test --test-reporter=tap` passed 87 tests.
- `telegram-bot`: `node scripts/dry-run.mjs` passed.
- `telegram-bot`: `node scripts/proactive-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/reminder-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-http-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-local-stt-dry-run.mjs` passed.

## Bridge Read-Only Smoke Update

Added after schedule shape update:

- `scripts/bridge-readonly-smoke.mjs` verifies the configured MCP bridge before
  Telegram polling starts.
- The smoke forces Telegram dry-run mode for itself, so it does not require a
  Telegram bot token.
- It performs only read-only MCP calls: `initialize`, `tools/list`,
  `ticktick_diagnostics`, `ticktick_today`, `ticktick_inbox`, and optional
  `ticktick_search_tasks` when `BRIDGE_SMOKE_SEARCH_QUERY` is set.
- It reports bridge URL target, bearer-token presence, required tool presence,
  and task counts without printing bearer values or task bodies.
- Deployment docs now place this smoke before live Telegram `/diagnostics`.

Latest targeted checks after bridge read-only smoke:

- `telegram-bot`: `node --test --test-reporter=tap
  test/bridge-readonly-smoke.test.mjs` passed 2 tests.
- `telegram-bot`: `node scripts/check.mjs` checked 46 JavaScript modules.
- `telegram-bot`: `node --test --test-reporter=tap` passed 89 tests.

## All-Today Schedule Repair Update

Added after bridge read-only smoke:

- `/postpone-today all tomorrow` creates a pending repair action for every task
  due today, including high-priority tasks.
- Natural phrases such as `cancel today's plans`, `move everything tomorrow`,
  and `перенеси всё на завтра` route to the same all-today repair action.
- Existing `/postpone-today tomorrow` behavior remains narrower and moves only
  non-high-priority tasks due today.
- Both repair modes still require `/confirm`; no TickTick write happens when
  the draft is created.
- The all-today mode moves only `dueBucket=today` tasks with task IDs. It does
  not touch overdue tasks in this gate.

Latest targeted checks after all-today repair:

- `telegram-bot`: `node --test --test-reporter=tap test/repair.test.mjs
  test/command-router.test.mjs` passed 41 tests.
- `telegram-bot`: `node scripts/dry-run.mjs` passed and shows `cancel today's
  plans` creating an `all_today` pending action.

Latest full checks after all-today repair:

- `telegram-bot`: `node scripts/check.mjs` checked 46 JavaScript modules.
- `telegram-bot`: `node --test --test-reporter=tap` passed 93 tests.
- `telegram-bot`: `node scripts/dry-run.mjs` passed.
- `telegram-bot`: `node scripts/proactive-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/reminder-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-http-dry-run.mjs` passed.
- `telegram-bot`: `node scripts/voice-local-stt-dry-run.mjs` passed.
- `local-stt-service`: `node scripts/check.mjs` checked 7 JavaScript modules.
- `local-stt-service`: `node --test --test-reporter=tap` passed 5 tests.
- `local-stt-service`: `node scripts/dry-run.mjs` passed.

## Remaining Risks

- Runtime state is file-backed by default, but no migration or encryption layer
  exists yet.
- Confirmed `/add`, `/complete`, and `/postpone-today` are mocked only; no live
  disposable-task smoke yet.
- Schedule repair write support is narrow: only non-high-priority today tasks to
  tomorrow.
- Real voice transcription is not implemented; the local STT service currently
  provides mock and command providers behind the `/transcribe` contract, but no
  real model runtime is bundled or configured.
- Proactive and reminder loops are implemented but not live-smoked in Telegram.
- Proactive/reminder loops send task content to configured chat IDs without an
  inbound user event; keep them disabled until read-only live smoke confirms the
  target chat IDs.

## Recommended Next Gate

Run a live Telegram read-only smoke:

1. create a bot token through BotFather;
2. set `.env` with `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, and MCP
   bridge credentials;
3. keep `TELEGRAM_CONFIRM_WRITES=false`, `TELEGRAM_VOICE_ENABLED=false`,
   `TELEGRAM_PROACTIVE_ENABLED=false`, and `TELEGRAM_REMINDERS_ENABLED=false`;
4. run the bot locally;
5. run `npm run bridge-readonly-smoke`;
6. send `/diagnostics`, `/brief`, and `/proactive` from the allowed private
   user;
7. only then test confirmed `/add` on a disposable task;
8. test `/complete`, `/postpone-today tomorrow`, and
   `/postpone-today all tomorrow` only on disposable tasks.

## Protected-Focus Repair Update

Added after the all-today repair gate:

- `/postpone-today rest tomorrow` creates a pending repair action that keeps the
  highest-priority today task or tied top-priority tasks and moves the remaining
  today tasks with IDs to tomorrow.
- Natural protected-focus phrases such as `keep only the highest-priority item
  and reschedule the rest`, `protect the main task`, `оставь главное`, and
  `перенеси остальное на завтра` route to the same pending repair action.
- Overdue tasks are not touched by this mode.
- The action still requires `/confirm`; no TickTick write occurs when the draft
  is created.

Latest checks after protected-focus repair:

- `telegram-bot`: `node scripts/check.mjs` passed, 46 JavaScript modules
  checked.
- `telegram-bot`: `node --test --test-reporter=tap` passed, 97 tests.
- `telegram-bot`: `node scripts/dry-run.mjs` passed and shows the protected
  focus phrase creating a pending postpone draft without writing.

## Travel Draft Refinement Update

Added after the protected-focus repair gate:

- Pending travel or appointment drafts now retain follow-up details such as
  `30 minutes`, `30 min`, `полчаса`, `40 минут`, `from home to the clinic`, and
  `от дома до клиники`.
- Duration answers stop the repeated trip-duration question.
- Route/location answers stop the repeated `from where to where` question while
  still allowing the bot to ask for duration because no traffic/weather estimate
  provider exists yet.
- Draft formatting shows captured follow-up details explicitly.
- No external route, traffic, or weather API is called.

Latest checks after travel draft refinement:

- `telegram-bot`: `node scripts/check.mjs` passed, 46 JavaScript modules
  checked.
- `telegram-bot`: `node --test --test-reporter=tap test\command-router.test.mjs`
  passed, 38 tests.
- `telegram-bot`: `node --test --test-reporter=tap` passed, 99 tests.
- `telegram-bot`: `node scripts/dry-run.mjs` passed and shows a doctor-trip
  draft capturing `30 minutes` before confirmed mocked creation.

## Deterministic Due-Date Capture Update

Added after travel draft refinement:

- Task drafts now infer simple due dates from `today`, `сегодня`, `tomorrow`,
  `завтра`, and `HH:mm`.
- All-day hints create TickTick-style `YYYY-MM-DDT00:00:00+0000` due dates with
  `isAllDay: true`.
- Timed hints such as `today 15:30` create TickTick-style timed due dates with
  `isAllDay: false`.
- `buildCreateTaskArgs` passes `dueDate`, `timeZone`, and `isAllDay` to
  `ticktick_create_task` only when the draft has an inferred date.
- Draft formatting shows the inferred due date before the user sends
  `/confirm`.
- Parsing remains deliberately narrow; no full natural-language calendar parser
  was added.

Latest checks after deterministic due-date capture:

- `telegram-bot`: `node scripts/check.mjs` passed, 47 JavaScript modules
  checked.
- `telegram-bot`: `node --test --test-reporter=tap test\capture.test.mjs
  test\command-router.test.mjs` passed, 40 tests.
- `telegram-bot`: `node --test --test-reporter=tap` passed, 101 tests.
- `telegram-bot`: `node scripts/dry-run.mjs` passed and shows `due: tomorrow
  2026-06-25 all-day (Europe/Moscow)` before confirmed mocked creation.

## Local STT Command Provider Update

Added after deterministic due-date capture:

- `integrations/local-stt-service` now supports `STT_PROVIDER=command` in
  addition to `mock`.
- `STT_COMMAND` is required for the command provider.
- `STT_COMMAND_ARGS` must be a JSON string array and must include `{audio}`.
- The service writes request audio to a temporary file, invokes the configured
  command with `shell: false`, parses stdout as JSON `{ "text": "..." }` or
  plain text, enforces `STT_COMMAND_TIMEOUT_MS`, and deletes the temporary file
  in `finally`.
- This is a service boundary only; no real STT binary or model artifact is
  bundled, downloaded, or configured.

Latest checks after local STT command provider:

- `local-stt-service`: `node scripts/check.mjs` passed, 7 JavaScript modules
  checked.
- `local-stt-service`: `node --test --test-reporter=tap` passed, 10 tests.
- `local-stt-service`: `node scripts/dry-run.mjs` passed with mock provider.
- `telegram-bot`: `node scripts/voice-local-stt-dry-run.mjs` passed through the
  HTTP voice adapter and loopback STT service.

## Local STT Run Ergonomics Update

Added after local STT command provider:

- `integrations/local-stt-service/.env.example` documents safe mock and command
  provider placeholders.
- `scripts/config-check.mjs` reads `.env` when present, overlays the process
  environment, validates provider configuration, and prints only redacted
  `set/missing` secret state.
- `npm run config-check` is available for local validation before startup.
- `scripts/start.ps1` starts the local STT service on Windows with an optional
  `-NodePath`.

Latest checks after local STT run ergonomics:

- `local-stt-service`: `node scripts/check.mjs` passed, 8 JavaScript modules
  checked.
- `local-stt-service`: `node scripts/config-check.mjs` passed with default mock
  config and no `.env`.
- `local-stt-service`: `node scripts/config-check.mjs` passed with a synthetic
  command-provider config.
- `local-stt-service`: negative config checks failed closed for missing
  `STT_COMMAND` and missing `{audio}` placeholder.
- `local-stt-service`: `node --test --test-reporter=tap` passed, 10 tests.
- `local-stt-service`: `node scripts/dry-run.mjs` passed with mock provider.

## Telegram Projects Command Update

Added after local STT run ergonomics:

- `/projects` and `/проекты` call read-only bridge tool
  `ticktick_list_projects`.
- The command formats project/list name plus ID, including Inbox when returned.
- Output respects `TELEGRAM_MAX_RESULTS` and shows remaining count when
  truncated.
- This command is intended to support `/set-route keyword=projectId` setup
  without requiring manual MCP inspection.

Latest checks after Telegram projects command:

- `telegram-bot`: `node scripts/check.mjs` passed, 47 JavaScript modules
  checked.
- `telegram-bot`: `node --test --test-reporter=tap test\command-router.test.mjs`
  passed, 40 tests.
- `telegram-bot`: `node --test --test-reporter=tap` passed, 102 tests.
- `telegram-bot`: `node scripts/dry-run.mjs` passed and shows `/projects`
  output with project IDs and truncation.

## Protected Bridge Read-Only Smoke

Accepted after local STT run ergonomics:

- The private deployment note contains the remote MCP URL and SSH metadata but
  no bearer token value.
- Direct remote bridge smoke without bearer failed with HTTP 401, confirming the
  public MCP endpoint is protected.
- The conductor retrieved the bearer secret from the remote systemd environment
  through SSH/sudo into a local process variable only; the value was not printed
  or written to disk.
- `telegram-bot`: `node scripts/bridge-readonly-smoke.mjs` passed against
  `https://<private-mcp-host>/mcp`.

Smoke result:

- `initialize`: ok
- `tools`: 40
- `requiredTools`: ok
- `diagnostics.ok`: true
- `todayTasks`: 13
- `inboxTasks`: 5
- `writesCalled`: false

Next live gate remains blocked on private Telegram bot configuration:
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS`.

## Live Readiness Preflight Update

Accepted after the protected bridge smoke:

- `scripts/live-readiness.mjs` combines startup config validation, bridge
  read-only smoke, and Telegram `getMe`.
- The preflight loads `.env` through the existing config loader and prints only
  redacted secret presence flags.
- In dry-run mode, Telegram credentials are not required and Telegram `getMe`
  is skipped.
- In live mode, missing `TELEGRAM_BOT_TOKEN` or
  `TELEGRAM_ALLOWED_USER_IDS` fails closed before Telegram polling can start.
- When live Telegram credentials are complete, the only Telegram API method
  called by this preflight is `getMe`; it does not call `getUpdates` or
  `sendMessage`.
- `npm run live-readiness` is available from `integrations/telegram-bot`.

Latest checks after live-readiness:

- `telegram-bot`: `node scripts/check.mjs` passed, 49 JavaScript modules
  checked.
- `telegram-bot`: `node --test --test-reporter=tap
  test\live-readiness.test.mjs` passed, 3 tests.
- `telegram-bot`: `node --test --test-reporter=tap` passed, 105 tests.
- `telegram-bot`: `node scripts/live-readiness.mjs` with
  `TELEGRAM_DRY_RUN=true` and an unreachable bridge URL failed closed as
  expected.
- `telegram-bot`: `node scripts/live-readiness.mjs` with
  `TELEGRAM_DRY_RUN=true` passed against
  `https://<private-mcp-host>/mcp`, using the remote systemd bridge bearer
  loaded into process env only. Result: initialize ok, 40 tools, required tools
  ok, diagnostics ok, today count 13, inbox count 5, no writes called.

Privacy handling:

- Remote bridge bearer token was not printed or written locally.
- No Telegram token was used.
- No Telegram polling or message send occurred.
- No TickTick write occurred.
