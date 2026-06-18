# TickTick MCP Bridge User Guide

TickTick MCP Bridge lets an AI assistant work with your TickTick account through the official TickTick Open API.

Each user connects their own TickTick account. The project does not include a shared token, and your tokens stay on your own machine or private server.

## What You Can Ask For

Tasks and lists:

- Show today's tasks, overdue tasks, Inbox tasks, or tasks from a specific list.
- Search tasks by title, content, tag, project, or checklist text.
- Create tasks with dates, priorities, tags, checklist items, and repeat rules.
- Update, complete, delete, or move tasks.
- List completed tasks for a time range.
- Filter tasks by project IDs, date range, priority, tags, or status.
- Review workload by project, due bucket, and priority.

Projects:

- List TickTick projects/lists.
- Get project details and project data.
- Create, update, or delete projects.

Habits:

- List your habits.
- Read one habit by ID.
- Create or update a habit.
- Mark a habit as checked in for a date.
- Read habit check-ins for one or more habits over a date range.

Focus and Pomodoro:

- List focus sessions for a time range.
- Read one focus session by ID.
- Summarize focus or Pomodoro time.
- Delete a focus record.

Diagnostics:

- Check whether TickTick auth is configured.
- Check whether the official API, projects, Inbox, and task collection are visible.

## Example Prompts

Try prompts like:

```text
Show my overdue TickTick tasks and group them by project.
```

```text
Find tasks about electricity, including Inbox, and show me the candidates before completing anything.
```

```text
Add a high-priority task for tomorrow: call the utility company.
```

```text
Show my completed tasks from this week.
```

```text
List my TickTick habits and show which ones have check-ins this week.
```

```text
Analyze my Pomodoro/focus time for the last 7 days.
```

## Safety Rules

The bridge exposes write tools. An assistant can create, update, complete, move, check in, or delete data when it calls those tools.

For natural-language task edits, the plugin includes safer candidate tools:

1. Search first with `ticktick_search_tasks` or `ticktick_find_task_candidates`.
2. If multiple tasks match, choose the exact task instead of guessing.
3. Complete by exact `projectId` and `taskId`, or use `ticktick_complete_task_safe`.

Deleting tasks, projects, focus records, or changing habits is consequential. Review the candidate or exact ID before approving those operations.

## TickTick Features Covered

This bridge implements official TickTick Open API coverage for:

- Tasks
- Projects/lists
- Inbox task discovery
- Tags as task fields
- Recurring task rules as `repeatFlag`
- Task reminders as task fields
- Completed-task history
- Advanced task filtering
- Habits and habit check-ins
- Focus and Pomodoro history

TickTick Inbox needs special handling. The official `/project` endpoint does not list Inbox as a normal project, so the bridge adds Inbox as a pseudo-project and reads Inbox tasks through `/project/inbox/data`.

## What Is Not Covered

These TickTick app features are not exposed in the official Open API at this time:

- Countdown
- Calendar subscriptions
- Eisenhower Matrix settings or layout

The assistant can still build derived views from normal task data. For example, it can approximate an Eisenhower-style view using due dates and priorities, or create a normal task that behaves like a countdown. That is not the same as synchronizing TickTick's native Countdown or Eisenhower modules.

## Calendar Notes

TickTick has calendar views in the app. The bridge does not need a separate calendar API for basic scheduling because task dates are available directly:

- `startDate`
- `dueDate`
- `timeZone`
- `isAllDay`
- `repeatFlag`
- `reminders`

This is enough for agenda-style planning, today/overdue reviews, and schedule analysis. External calendar subscriptions are not covered by the official Open API.

## Habit Notes

Habit support uses the official Habit API. You can read habits, create/update habits, check in a habit, and read check-ins.

Common useful prompts:

```text
Show my habits and today's check-in status.
```

```text
Check in my reading habit for today.
```

```text
Analyze which habits I missed this week.
```

## Focus And Pomodoro Notes

Focus support uses the official Focus API. TickTick uses focus type `0` for Pomodoro and type `1` for Timing.

The official API supports reading and deleting focus records. It does not document creating new focus sessions through Open API.

Common useful prompts:

```text
Show my Pomodoro sessions this week.
```

```text
How many minutes did I spend in focus mode today?
```

```text
Summarize my focus sessions by day.
```

## Setup Summary

For Codex, install the plugin from this marketplace:

```powershell
codex plugin marketplace add zoomerland/ticktick-mcp-bridge
codex plugin add ticktick-mcp-bridge@ticktick-mcp-bridge
```

For ChatGPT, you need a self-hosted HTTPS MCP endpoint. See:

- [Authorization](AUTH.md)
- [Self-hosting](SELF_HOSTING.md)

## Troubleshooting

If tasks seem missing:

1. Run `ticktick_diagnostics`.
2. Confirm `auth_configured` is OK.
3. Confirm Inbox checks are OK.
4. Search with `ticktick_search_tasks`, not only project-by-project iteration.

If ChatGPT cannot connect:

- Check that your public HTTPS endpoint is still alive.
- Check `APP_SHARED_SECRET` if you enabled bearer authentication.
- Temporary tunnel URLs can expire; persistent hosting is more reliable.

If Codex cannot start the plugin:

- Make sure Node.js is available.
- On Windows, the bundled launcher tries Codex's Node runtime first.
- Reinstall the plugin after marketplace updates.
