# Telegram Bot Deployment

This service is intentionally portable:

- local Windows foreground process for early testing;
- later systemd service on the existing VPS;
- no inbound public port in polling mode.

## Local Windows Run

Create `.env` from `.env.example`:

```powershell
Copy-Item .env.example .env
```

Set at least:

```text
TELEGRAM_BOT_TOKEN=replace-with-token-from-BotFather
TELEGRAM_ALLOWED_USER_IDS=replace-with-your-telegram-user-id
TELEGRAM_CONFIRM_WRITES=false
TELEGRAM_PROJECT_ROUTES=doctor=project-health;work=project-work
TELEGRAM_PROACTIVE_ENABLED=false
TELEGRAM_PROACTIVE_CHAT_ID=replace-with-your-private-chat-id-when-enabled
TELEGRAM_CHECKIN_ENABLED=false
TELEGRAM_CHECKIN_CHAT_ID=replace-with-your-private-chat-id-when-enabled
TELEGRAM_CHECKIN_INTERVAL_MINUTES=120
TELEGRAM_CHECKIN_HOURS=9-21
TELEGRAM_REMINDERS_ENABLED=false
TELEGRAM_REMINDER_CHAT_ID=replace-with-your-private-chat-id-when-enabled
TELEGRAM_TRAVEL_DEFAULT_MINUTES=45
TELEGRAM_TRAVEL_BUFFER_MINUTES=15
TELEGRAM_VOICE_ENABLED=false
TELEGRAM_VOICE_PROVIDER=disabled
TELEGRAM_VOICE_DOWNLOAD_ENABLED=false
TELEGRAM_VOICE_MAX_BYTES=10485760
TELEGRAM_STATE_FILE=data/telegram-state.json
TICKTICK_MCP_URL=https://ticktick-mcp.example.com/mcp
TICKTICK_MCP_BEARER_TOKEN=replace-with-bridge-bearer-token-if-needed
```

Then run:

```powershell
npm run config-check
.\scripts\start.ps1 -NodePath "C:\Path\To\node.exe"
```

If `node` is on `PATH`, this is enough:

```powershell
.\scripts\start.ps1
```

The Node process reads `.env` directly. Do not commit `.env` or `data/`.

## VPS Shape

Recommended first deployment:

```text
Telegram Bot API
  -> ticktick-telegram-bot systemd service
  -> optional local-stt-service on 127.0.0.1 for voice transcription
  -> http://127.0.0.1:8787/mcp
  -> ticktick-mcp-bridge systemd service
```

Use a separate service user and env file for the bot. Keep the bridge loopback
bound and reuse the existing Caddy setup only for MCP/ChatGPT, not for Telegram
polling.

Example service:

```ini
[Unit]
Description=TickTick Telegram Bot
After=network-online.target ticktick-mcp-bridge.service
Wants=network-online.target

[Service]
Type=simple
User=ticktick-telegram
Group=ticktick-telegram
WorkingDirectory=/opt/ticktick-mcp-bridge/integrations/telegram-bot
EnvironmentFile=/etc/ticktick-telegram-bot.env
ExecStart=/usr/bin/node src/index.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

## Validation Order

1. `npm run check` or `node scripts/check.mjs`
2. `npm run config-check` or `node scripts/config-check.mjs`
3. `npm test` or `node --test`
4. `npm run dry-run` or `node scripts/dry-run.mjs`
5. `npm run proactive-dry-run` or `node scripts/proactive-dry-run.mjs`
6. `npm run checkin-dry-run` or `node scripts/checkin-dry-run.mjs`
7. `npm run reminder-dry-run` or `node scripts/reminder-dry-run.mjs`
8. `npm run voice-dry-run` or `node scripts/voice-dry-run.mjs`
9. `npm run voice-http-dry-run` or `node scripts/voice-http-dry-run.mjs`
10. `npm run voice-local-stt-dry-run` or
   `node scripts/voice-local-stt-dry-run.mjs`
11. `npm run resource-stress` or `node --expose-gc scripts/resource-stress.mjs`
12. `npm run bridge-readonly-smoke` or
    `node scripts/bridge-readonly-smoke.mjs`
13. `npm run live-readiness` or `node scripts/live-readiness.mjs`
14. send one live Telegram `/diagnostics` from an allowed private user
15. `npm run live-poll-once` or `node scripts/live-poll-once.mjs`
16. one manual `/checkin`, `/proactive`, and `/reminders`
17. only then enable `TELEGRAM_CHECKIN_ENABLED=true`,
    `TELEGRAM_PROACTIVE_ENABLED=true`, or `TELEGRAM_REMINDERS_ENABLED=true`

`bridge-readonly-smoke` reads `.env`, forces Telegram dry-run mode for that
script, and performs only MCP read-only calls: `initialize`, `tools/list`,
`ticktick_diagnostics`, `ticktick_today`, `ticktick_inbox`, and optionally
`ticktick_search_tasks` when `BRIDGE_SMOKE_SEARCH_QUERY` is set. It reports
counts and secret presence only; it does not print bearer values or task bodies.

`live-readiness` reads `.env`, prints the redacted config summary, reruns the
read-only bridge smoke, and performs only Telegram Bot API `getMe` when
`TELEGRAM_BOT_TOKEN` is set and the live Telegram config is otherwise valid. It
must not be used as polling: it does not call `getUpdates`, `sendMessage`, or
any write flow. Missing live token or allowlist values fail closed with next
steps; `TELEGRAM_DRY_RUN=true` remains available for no-token bridge readiness
checks.

`live-poll-once` is the bounded live Telegram smoke after the allowed private
user sends one message such as `/diagnostics`. It keeps confirmed writes off by
default, forces autonomous loops off, fetches at most a small limited batch of
updates, sends normal command replies, acknowledges the processed offset, and
prints only a redacted summary of update ids and command labels. For a
disposable write gate, both `LIVE_POLL_ONCE_ALLOW_WRITES=true` and
`TELEGRAM_CONFIRM_WRITES=true` must be set for that one run.

`resource-stress` is local and synthetic. It does not call Telegram or TickTick;
it runs many mock updates through the real command router and reports wall time,
CPU, latency, reply kinds, bridge call counts, and memory deltas.

Confirmed `/add`, `/complete`, `/postpone-today tomorrow`,
`/postpone-today all tomorrow`, and `/postpone-today rest tomorrow` are
implemented.
Live-test them only with clearly disposable tasks after read-only diagnostics
pass and after setting `TELEGRAM_CONFIRM_WRITES=true`. `/move` and broad
multi-day schedule repair writes are not implemented yet.

Travel estimates are local placeholders only. `TELEGRAM_TRAVEL_DEFAULT_MINUTES`
and `TELEGRAM_TRAVEL_BUFFER_MINUTES` let the bot reserve a conservative block
after the user gives route context and time of day. No weather, traffic, or
maps provider is called in this gate.

State lives in `TELEGRAM_STATE_FILE`. It contains pending drafts/actions,
check-in/proactive/reminder dedupe state, and the local user profile. Treat it
as private runtime state.

Voice transcription is intentionally disabled for live startup. The `mock`
provider is for local adapter validation only; it must not be treated as a real
STT provider. The `http` provider is a boundary for a future local STT service.
Keep `TELEGRAM_VOICE_DOWNLOAD_ENABLED=false` until that service is healthy; when
enabled, downloaded Telegram voice files are kept in memory only and rejected
above `TELEGRAM_VOICE_MAX_BYTES`.

## Local STT Service

The companion service lives in `../local-stt-service/`. It currently provides
mock and command providers and exists to validate the HTTP contract before any
real model runtime is added.

Run its local gate before enabling Telegram voice download:

```powershell
cd ..\local-stt-service
npm run check
npm run config-check
npm test
npm run dry-run
```

For a local bot-to-STT smoke, start the STT service on loopback and point the
bot at it:

```text
TELEGRAM_VOICE_PROVIDER=http
TELEGRAM_VOICE_HTTP_URL=http://127.0.0.1:9876/transcribe
TELEGRAM_VOICE_DOWNLOAD_ENABLED=true
```

For a reviewed local executable, configure the service with:

```text
STT_PROVIDER=command
STT_COMMAND=/path/to/local-transcriber
STT_COMMAND_ARGS=["--input","{audio}"]
STT_COMMAND_TIMEOUT_MS=30000
```

`STT_COMMAND_ARGS` is a JSON array and must include `{audio}`. The service runs
the command with `shell: false`, writes each request's audio to a temporary file,
and removes that file after the request.

Do not expose this service publicly without a separate security review.
