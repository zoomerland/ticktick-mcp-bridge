# Telegram Bot Resource Stress Handoff

Date: 2026-06-24

## Role And Scope

- Conductor-owned resource stress gate for the Telegram secretary.
- Repo path: `C:\Users\Zoomerland\Documents\TiickTick`.
- Branch: `codex/telegram-bot`.
- Tracking branch: none configured.
- Base commit: `fc8d5caf86eba675443a7d20c88ac7fef7ba2c8c`.
- Worktree status: dirty local worktree; no commits or pushes made.
- Scope: local synthetic command-router stress with resource measurement.
- Non-goals: no live Telegram calls, no live TickTick calls, no writes, no
  long-running service process, no voice/STT.

## Files Changed

- `.agents/orchestra/roadmap.md`
- `.agents/orchestra/handoffs/2026-06-24-telegram-bot-resource-stress.md`
- `integrations/telegram-bot/README.md`
- `integrations/telegram-bot/docs/DEPLOYMENT.md`
- `integrations/telegram-bot/package.json`
- `integrations/telegram-bot/scripts/resource-stress.mjs`

## Behavior Added

- Added `npm run resource-stress`.
- The stress runner:
  - uses `TELEGRAM_DRY_RUN=true`;
  - keeps `TELEGRAM_CONFIRM_WRITES=false`;
  - uses mock Telegram updates and a mock bridge;
  - routes updates through the real `handleUpdate` command-router path;
  - throws if any write-like TickTick tool is called;
  - reports wall time, CPU, latency, memory, reply kinds, bridge call counts,
    and whether pending session state remains afterward.

## Checks Run

Using bundled Node from Codex runtime:

```text
STRESS_UPDATES=100 node --expose-gc scripts/resource-stress.mjs
```

Result: passed. Pending state was clear afterward.

```text
STRESS_UPDATES=10000 node --expose-gc scripts/resource-stress.mjs
```

Result: passed.

Key metrics:

- wall time: 353.27ms
- throughput: 28,306.95 updates/s
- p95 latency: 0.099ms
- p99 latency: 0.255ms
- max RSS: 50.42 MiB
- max heap used: 7.37 MiB
- final-GC delta: +9.09 MiB RSS, +0.87 MiB heap
- pending state after stress: false

```text
STRESS_UPDATES=100000 node --expose-gc scripts/resource-stress.mjs
```

Result: passed.

Key metrics:

- wall time: 1,966.72ms
- throughput: 50,846.16 updates/s
- CPU: 1,984ms, about 100.88% of one core
- p50 latency: 0.010ms
- p95 latency: 0.062ms
- p99 latency: 0.115ms
- max latency: 5.763ms
- max RSS: 54.18 MiB
- max heap used: 11.36 MiB
- final-GC delta: +14.46 MiB RSS, +1.69 MiB heap
- replies simulated: 100,000
- reply bytes simulated: 32,214,767
- pending state after stress: false

```text
node scripts/check.mjs
```

Result: `Checked 56 JavaScript modules.`

```text
node --test --test-reporter=tap
```

Result: 118 tests, 118 pass.

```text
git diff --check
```

Result: passed. Git warned that `.gitignore` and `README.md` may be converted
from LF to CRLF when touched by Git on Windows.

## Privacy Handling

- No Telegram token used.
- No TickTick bearer/OAuth secret used.
- No live Telegram request made.
- No live TickTick request made.
- No private task body printed or committed.
- Stress data is synthetic.

## Findings

- Command-router CPU and memory footprint look safe for the expected polling
  workload.
- Heap growth after final GC was small (+1.69 MiB after 100,000 updates).
- No pending draft, action, or check-in state remained after the stress cycle.
- The stress runner does not measure live network latency, Telegram Bot API
  rate limits, TickTick API latency, or systemd process behavior.

## Recommended Next Gate

When work resumes, choose between:

- configuring normal project/list routing for future `/add` flows;
- running the bot as a supervised long-running service and measuring idle plus
  low-rate polling RSS over time.
