---
name: ticktick-mcp-bridge
description: Use when the user wants to manage, review, monitor, summarize, create, update, complete, or delete TickTick tasks and projects through the self-hosted TickTick MCP Bridge. Requires one-time TickTick OAuth setup or a bearer token.
---

# TickTick MCP Bridge

Use this skill when the user wants Codex to work with TickTick tasks, projects, workload summaries, or planning data.

The plugin runs a local stdio MCP server and talks to TickTick's Open API. Each user authorizes their own TickTick account; no shared token is bundled with the plugin.

## First-Time Auth

If `ticktick_auth_status` says authentication is missing:

1. Ask the user for a TickTick developer app `client_id` and `client_secret`, or an existing bearer token.
2. Call `ticktick_set_oauth_app` if they provide OAuth app credentials.
3. Call `ticktick_get_auth_url`.
4. Have the user open the returned URL, authorize TickTick, and paste back the redirected URL or `code`.
5. Call `ticktick_exchange_code`.

The server stores OAuth credentials and tokens locally under the user's application data folder, or in `TICKTICK_AUTH_FILE` if that environment variable is set.

Do not store the user's TickTick, Google, or email password.

## Tooling Pattern

- Use `ticktick_diagnostics` first when the server connects but tasks look incomplete, especially if Inbox tasks may be missing.
- Use `ticktick_today` for today, overdue, and near-term reviews.
- Use `ticktick_overdue` for a direct overdue queue.
- Use `ticktick_inbox` when the user specifically asks about Inbox or uncategorized tasks.
- Use `ticktick_analyze_workload` before making priority or schedule recommendations.
- Use `ticktick_filter_tasks_official` when the user asks for precise API-level filtering by project IDs, date range, priority, tags, or status.
- Use `ticktick_list_completed_tasks` when the user asks what was completed in a time range.
- Use `ticktick_list_projects` before creating a task in a named project if the user did not provide a project ID.
- Use `ticktick_create_task` for new tasks.
- Use `ticktick_search_tasks` or `ticktick_find_task_candidates` before completing, updating, moving, or deleting a task identified by title instead of ID.
- If candidates are ambiguous, show the candidates and ask the user to choose. Do not complete, move, update, or delete a guessed task.
- Use `ticktick_complete_task_safe` for natural-language completion requests. It will act only on exact IDs or one safe candidate unless explicitly configured otherwise.
- Use `ticktick_move_task` to move a task to another project/list after both source and destination project IDs are known. It uses the official `/task/move` endpoint and needs `fromProjectId`, `toProjectId`, and `taskId`.
- Use `ticktick_get_task` by ID for final verification after changing a task.
- Use `ticktick_list_habits`, `ticktick_get_habit`, `ticktick_list_habit_checkins`, and `ticktick_checkin_habit` for TickTick Habit Tracker work.
- Use `ticktick_list_focuses` and `ticktick_analyze_focus` for Pomodoro/Focus history. Focus type `0` is Pomodoro and type `1` is Timing.
- Remember that TickTick Inbox is included as a pseudo-project because TickTick's `/project` API does not list it. Search/list calls should include Inbox tasks as well as normal projects.
- Do not manually enumerate only `ticktick_list_projects` results and assume that covers every task. Use `ticktick_list_tasks` for task search, or explicitly include Inbox through `/project/inbox/data`.

## Safety Pattern For Natural-Language Edits

When the user says something like "find the electricity task and mark it complete":

1. Call `ticktick_find_task_candidates` with the user's phrase.
2. If it returns `decision.canAct: false`, summarize the candidates with titles, due dates, project names, and IDs.
3. If it returns one safe candidate, call `ticktick_complete_task_safe` with `projectId` and `taskId`.
4. Verify with `ticktick_get_task` when the completed task remains readable by the Open API; otherwise report the completion response.

## API Notes

TickTick Open API uses:

- Base URL: `https://api.ticktick.com/open/v1`
- OAuth authorize URL: `https://ticktick.com/oauth/authorize`
- OAuth token URL: `https://ticktick.com/oauth/token`
- Scopes: `tasks:read tasks:write`

The official Open API is narrower than the TickTick web app. If a requested operation is not exposed by the official API, explain the limitation and offer the closest available workflow.

Officially exposed beyond tasks/projects:

- Focus/Pomodoro: read by ID, read by time range, delete.
- Habits: list, get, create, update, check in, list check-ins.

No official Open API endpoint is currently documented for Countdown, calendar subscriptions, or Eisenhower Matrix. Do not claim to synchronize those modules directly unless TickTick adds official endpoints.
