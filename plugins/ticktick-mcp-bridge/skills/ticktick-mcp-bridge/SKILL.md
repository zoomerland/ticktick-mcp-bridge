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

- Use `ticktick_today` for today, overdue, and near-term reviews.
- Use `ticktick_analyze_workload` before making priority or schedule recommendations.
- Use `ticktick_list_projects` before creating a task in a named project if the user did not provide a project ID.
- Use `ticktick_create_task` for new tasks.
- Use `ticktick_get_project_data` or `ticktick_list_tasks` before completing, updating, or deleting a task identified by title instead of ID.
- Use `ticktick_get_task` by ID for final verification after changing a task.
- Remember that TickTick Inbox is included as a pseudo-project. Search/list calls should include Inbox tasks as well as normal projects.

## API Notes

TickTick Open API uses:

- Base URL: `https://api.ticktick.com/open/v1`
- OAuth authorize URL: `https://ticktick.com/oauth/authorize`
- OAuth token URL: `https://ticktick.com/oauth/token`
- Scopes: `tasks:read tasks:write`

The official Open API is narrower than the TickTick web app. If a requested operation is not exposed by the official API, explain the limitation and offer the closest available workflow.
