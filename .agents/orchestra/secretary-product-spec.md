# Telegram Secretary Product Spec

Date: 2026-06-24

## Goal

Build a personal Telegram secretary that actively helps the user run the day,
using TickTick MCP Bridge as the task and planning backend.

This is not just a reminder bot. The target behavior is an organizer that can
notice schedule pressure, ask clarifying questions, suggest changes, and help
move the day forward.

## Core Outcomes

- The secretary can summarize the current day, overdue work, Inbox, and nearby
  commitments.
- The secretary can initiate check-ins when time, task pressure, or schedule
  gaps make that useful.
- The secretary can help create tasks from natural language and ask for missing
  planning details.
- Travel and appointment drafts can retain user-supplied duration or route
  context across follow-up replies.
- Travel and appointment drafts can attach a local placeholder estimate when
  the user does not know duration but provides route context and time of day.
  This estimate must be labeled as local-only until weather, traffic, or maps
  providers are explicitly integrated.
- Task drafts can infer simple due dates from today, tomorrow, and HH:mm hints
  before confirmed creation.
- The secretary can help reschedule when the user says they are late, tired, or
  changing plans.
- The secretary can route tasks to the right TickTick project/list instead of
  dumping everything into Inbox.
- The secretary can keep a lightweight user profile: sleep window, working
  rhythm, preferred reminder lead time, travel assumptions, and routing
  preferences.
- The secretary can eventually accept voice messages, transcribe them, and turn
  them into the same planning flow as text.

## Non-Goals For The First Implementation Slice

- No live Telegram calls without a bot token and explicit allowed user IDs.
- No autonomous writes to TickTick.
- No raw voice transcription pipeline.
- No traffic, weather, or calendar provider integration.
- No broad LLM planning loop before command routing and safety gates are stable.

## First Implementation Slice

Create a local-first, portable Telegram bot service:

- long polling mode;
- no inbound public port;
- fail-closed config;
- read-only commands only;
- MCP HTTP calls to TickTick MCP Bridge;
- dry-run mode with mocked bridge responses;
- unit tests for config, authorization, command routing, and MCP JSON-RPC shape.

## Future Capability Stages

### Stage 1: Read-Only Assistant

- `/diagnostics`
- `/today`
- `/overdue`
- `/inbox`
- `/search <query>`
- Russian command aliases after the English command surface is stable.

### Stage 2: Confirmed Task Operations

- Add a task with project/list routing.
- Complete a task only after candidate confirmation.
- Move a task only after candidate and destination confirmation.
- Never silently route user tasks to Inbox when a known list is a better fit.

### Stage 3: Planning Conversation

- Ask clarifying questions for underspecified tasks.
- Track "I am late" and "cancel today" intents.
- Propose a schedule repair before writing changes.
- Support a confirmed "cancel today's plan" repair that moves all tasks due
  today to tomorrow.
- Support a confirmed protected-focus repair that keeps the highest-priority
  today item or tied items and moves the remaining today tasks to tomorrow.
- Keep proposed changes separate from committed TickTick writes.

### Stage 4: Proactive Day Steward

- Periodic review of free time, overload, overdue tasks, and upcoming work.
- Detect large open windows before the next timed task and ask whether to
  preserve rest or add a useful block.
- Detect near-term density when several timed items cluster in the next two
  hours.
- Surface untimed today tasks that need a concrete time.
- User-configurable check-in windows.
- Quiet hours based on sleep profile.
- Nudges before task start windows.

Nearest check-in gate:

- `/checkin` performs only read-only bridge calls and returns a concrete
  secretary question based on overdue tasks, overload, free windows, Inbox, or
  untimed today items.
- A reply after a check-in can be routed back into existing safe flows such as
  schedule repair or task capture.
- Any schedule-changing outcome remains a pending action and still requires
  `/confirm`.
- The gate must be covered by synthetic tests and dry-run output before live
  Telegram is attempted.

### Stage 5: Voice And Context Providers

- Voice-message transcription.
- Local command-based STT provider behind the `/transcribe` boundary after
  explicit model/runtime review.
- Optional traffic/weather lookup for travel-related tasks.
- Optional calendar provider integration.
- Summaries remain redacted by default in logs.

## Safety Invariants

- Telegram users are denied unless explicitly allowed.
- Group chats are disabled unless explicitly allowed.
- Write operations require confirmation.
- Secrets stay in `.env`, systemd env files, or platform secret stores.
- Logs redact bot tokens, bearer tokens, OAuth secrets, and task content by
  default.
- Bridge diagnostics are the first live health gate.
