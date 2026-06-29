# Telegram Bot Travel Estimate Gate Handoff

Date: 2026-06-24

## Role And Scope

- Conductor-owned continuation for the Telegram secretary implementation.
- Repo path: `C:\Users\Zoomerland\Documents\TiickTick`.
- Branch: `codex/telegram-bot`.
- Scope: local travel-planning placeholder for appointment/trip task drafts.
- Non-goals: no live Telegram calls, no TickTick live writes, no LLM, no
  weather, traffic, maps, or calendar provider.

## Files Changed

- `.agents/orchestra/roadmap.md`
- `.agents/orchestra/secretary-product-spec.md`
- `.agents/orchestra/handoffs/2026-06-24-telegram-bot-travel-estimate-gate.md`
- `integrations/telegram-bot/.env.example`
- `integrations/telegram-bot/README.md`
- `integrations/telegram-bot/docs/DEPLOYMENT.md`
- `integrations/telegram-bot/scripts/config-check.mjs`
- `integrations/telegram-bot/scripts/dry-run.mjs`
- `integrations/telegram-bot/src/config.mjs`
- `integrations/telegram-bot/src/secretary/capture.mjs`
- `integrations/telegram-bot/test/capture.test.mjs`
- `integrations/telegram-bot/test/command-router.test.mjs`

## Behavior Added

- `TELEGRAM_TRAVEL_DEFAULT_MINUTES` configures the local base travel estimate.
- `TELEGRAM_TRAVEL_BUFFER_MINUTES` configures the local buffer.
- If a travel/appointment draft lacks a duration and the user says they do not
  know, the bot now asks for route context and time of day instead of repeatedly
  asking for duration.
- Once route context and time of day are present, the draft gets a local travel
  estimate of `default + buffer` minutes.
- Draft output labels the estimate as local default plus buffer and explicitly
  says weather/traffic were not checked.
- Confirmed task creation adds the estimate to task content only after
  `/confirm`.

## Checks Run

Using bundled Node:

```text
node scripts/check.mjs
```

Result: `Checked 54 JavaScript modules.`

```text
node --test --test-reporter=tap test\capture.test.mjs test\command-router.test.mjs
```

Result: 43 tests, 43 pass.

```text
node --test --test-reporter=tap
```

Result: 117 tests, 117 pass.

```text
node scripts/dry-run.mjs
```

Result: passed; dry-run demonstrates:

- `/add go to doctor tomorrow`
- `I don't know, from home to clinic`
- bot asks for time of day
- `at 09:00`
- bot shows `travel estimate: 60 minutes`
- bot marks weather/traffic as not checked
- `/confirm` creates through the mocked bridge only

## Privacy Handling

- No Telegram token used.
- No live Telegram request made.
- No TickTick bearer/OAuth secret printed or written.
- No live TickTick write made.
- No route, address, or private travel data committed.

## Remaining Risks

- Estimate is deliberately coarse and deterministic.
- Russian "unknown duration" handling is not yet fully normalized across
  mojibake/UTF-8 variants in the existing test corpus.
- Weather, traffic, maps, and calendar providers remain future gates.

## Recommended Next Gate

Add a context-provider boundary for weather/traffic/calendar that is disabled
by default and can be mocked locally before any real provider is configured.
