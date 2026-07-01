# Telegram LLM Dev-Live Roadmap

## Current State

- The Telegram bot already talks to TickTick through the HTTP MCP bridge.
- The bot does not call the TickTick Open API directly.
- The current Telegram surface is a curated secretary subset:
  - read-only: diagnostics, today, overdue, projects, inbox, search, brief,
    check-in, proactive review, reminders;
  - writes through drafts: add task, complete task, postpone today/rest/all;
  - writes are routed through the existing command router and bridge tools.
- The new LLM layer is opt-in with `TELEGRAM_LLM_ENABLED=true`.
- The LLM layer has two modes:
  - chat mode for warm planning conversation;
  - executor mode for strict JSON command planning.
- Executor mode does not talk to TickTick directly. It emits an existing bot
  command, and the normal router handles MCP calls and safety gates.
- Local Ollama is the current dev-live model path, with `qwen3:14b` as the
  balanced default from local tests.
- OpenAI is now represented as a provider adapter behind the same `chat()`
  interface, but live OpenAI calls require an explicit API key and
  `TELEGRAM_LLM_OPENAI_MODEL`.

## Target State

The Telegram secretary should become a text-first, then voice-input-capable,
personal agent that can:

1. Hold a natural planning conversation.
2. Decide when a real TickTick operation is needed.
3. Use a strict executor mode for actual operations.
4. Reuse one TickTick/MCP bridge contract instead of duplicating API logic.
5. Switch between local LLM and OpenAI-backed LLM providers by configuration.
6. Run dev-live against a private local model reachable over a private network
   tunnel.
7. Preserve a safe write policy while reducing awkward command ceremony.

## Why Literal `/confirm` Exists Now

Literal `/confirm` is a legacy safety gate from the deterministic bot era. It
exists because earlier bot flows were command-based, and writes needed a clear
human confirmation before changing TickTick.

That gate is not a claim that the model cannot follow instructions. It is a
guardrail against accidental writes, prompt injection, Telegram message
ambiguity, and model output drift.

The current dev-live LLM executor intentionally cannot emit `confirm`. This is
the safest default for the first live test: the model can prepare drafts, but
the user must still execute writes explicitly.

## Confirmation Direction

The end goal is not necessarily a literal `/confirm` forever. The target is a
policy-based write gate:

- low-risk read-only actions can execute immediately;
- draft-producing actions can be prepared by the model;
- high-risk writes require a clear approval signal;
- the approval signal can later become natural language, button-based, or a
  trusted session policy instead of only `/confirm`;
- destructive operations remain separate and stricter.

Do not remove the write gate globally until there is a reviewed policy and a
live smoke proving the model cannot confirm its own pending write.

## Provider Adapter Plan

Current provider interface:

- `OllamaChatClient` for local models through `/api/chat`;
- `OpenAIChatClient` for OpenAI Chat Completions-compatible calls;
- both expose `chat({ messages, model, format, options })`.

Next provider gates:

1. Add a provider-level smoke script that runs the same router/executor cases
   against `ollama` and `openai` with secrets supplied only through env.
2. Add a stricter structured-output option for OpenAI when a selected model
   supports it.
3. Keep the existing JSON validator and one repair retry for both providers.
4. Keep OpenAI model names explicit in env; do not hardcode a public default
   model until the deployment target is chosen.

## Local LLM Tunnel Note

The dev-live bridge/VPS path will need private connectivity to the local LLM.

Known current local model access pattern:

- local model host is reachable only through the owner's private VPN/Tailscale
  and SSH setup;
- Ollama must stay bound to the model host's loopback interface, normally
  `127.0.0.1:11434`;
- working local test shape: SSH or VPN local forward to
  `127.0.0.1:<local-port>`.

Future VPS shape to test later:

- establish a private VPN/Tailscale route from the MCP/Telegram backend host to
  the local model host;
- do not expose Ollama publicly;
- point `TELEGRAM_LLM_OLLAMA_URL` at the private tunnel endpoint;
- verify health with a no-secret model smoke before enabling Telegram polling.

## Next Gates

1. Commit this dev-live slice.
2. Run local no-secret checks and synthetic LLM tests.
3. Run one live Telegram text smoke with `TELEGRAM_LLM_ENABLED=true` and writes
   disabled or confirmation-gated.
4. Decide the first non-literal confirmation policy.
5. Add provider smoke coverage for OpenAI once an API key and model are chosen.
