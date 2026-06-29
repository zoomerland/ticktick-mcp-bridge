# Telegram Bot Agent

Baseline skill: `orchestra-agent`

This role owns the future Telegram bot workstream. The first deliverable is an
architecture and security plan, not immediate runtime code.

## Suggested Branch

`codex/telegram-bot`

## Approved Initial Runtime Path

`integrations/telegram-bot/`

## Initial Scope

- Implement a read-only long-polling Telegram bot skeleton.
- Talk to TickTick MCP Bridge through HTTP MCP first.
- Keep TickTick OAuth credentials and auth files bridge-owned.
- Fail closed unless `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS` are
  configured for live polling.
- Support dry-run and mocked bridge tests without secrets.
- Add write commands only after confirmation and routing rules are explicit.

## Possible Future Docs Path

- `plugins/ticktick-mcp-bridge/docs/TELEGRAM_BOT.md`

## Non-Goals

- Do not change TickTick OAuth behavior without conductor approval.
- Do not edit bridge internals before the interface contract is accepted.
- Do not commit Telegram tokens, chat IDs, user task data, or raw private logs.
- Do not expose the bot publicly before auth and rate-limit behavior are clear.

## Expected Validation

For the first planning handoff:

- repository inspection completed;
- proposed file layout;
- proposed environment variables;
- threat model for token exposure and unauthorized Telegram users;
- first smoke-test command or script shape;
- explicit open questions for the conductor.

For later implementation:

- static checks for the bot package;
- one synthetic command handling test;
- one no-secret startup smoke;
- one controlled live Telegram smoke only after user approval.
