import { clearAuth, loadAuth, redactAuth, saveAuth } from "./auth-store.mjs";
import {
  buildAuthUrl,
  exchangeAuthorizationCode,
  parseDate,
  prune,
  taskDueBucket,
  ticktickRequest,
} from "./ticktick-api.mjs";
import { runDiagnostics } from "./diagnostics.mjs";
import {
  analyzeFocus,
  deleteFocus,
  focusTypeSchema,
  getFocus,
  listFocuses,
} from "./focus-operations.mjs";
import {
  checkInHabit,
  createHabit,
  getHabit,
  habitCheckinFields,
  habitFields,
  listHabitCheckins,
  listHabits,
  updateHabit,
} from "./habit-operations.mjs";
import {
  apiProjectId,
  fetchAllTasks,
  fetchProjects,
  filterTasks,
  workloadSummary,
} from "./ticktick-data.mjs";
import {
  analyzeWorkload,
  completeTaskSafe,
  findTaskCandidates,
  filterTasksOfficial,
  listInboxTasks,
  listCompletedTasks,
  listOverdueTasks,
  moveTask,
  searchTasks,
} from "./task-operations.mjs";

const checklistItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    startDate: { type: ["string", "null"], description: "Date-time string, or null to clear the checklist item start date." },
    isAllDay: { type: "boolean" },
    sortOrder: { type: "number" },
    timeZone: { type: "string" },
    status: { type: "number", enum: [0, 1], description: "Checklist item status: 0 normal, 1 completed." },
    completedTime: { type: ["string", "null"], description: "Date-time string, or null to clear the checklist item completed time." },
  },
};

const taskFields = {
  id: { type: "string" },
  title: { type: "string" },
  content: { type: "string" },
  desc: { type: "string", description: "Checklist description." },
  projectId: { type: "string", description: "Project/list ID. Use inbox for TickTick Inbox when supported by the endpoint." },
  dueDate: { type: ["string", "null"], description: "Example: 2026-06-01T09:00:00+0000. Use null to clear the due date." },
  startDate: { type: ["string", "null"], description: "Date-time string, or null to clear the start date." },
  timeZone: { type: "string" },
  isAllDay: { type: "boolean" },
  priority: { type: "number", enum: [0, 1, 3, 5], description: "TickTick priority: 0 none, 1 low, 3 medium, 5 high." },
  tags: { type: "array", items: { type: "string" } },
  items: { type: "array", items: checklistItemSchema },
  kind: { type: "string", enum: ["TEXT", "NOTE", "CHECKLIST"] },
  columnId: { type: "string" },
  sortOrder: { type: "number" },
  reminders: { type: "array", items: { type: "string" } },
  repeatFlag: { type: "string" },
};

const projectFields = {
  name: { type: "string" },
  color: { type: "string", description: "Hex color, e.g. #4772FA." },
  sortOrder: { type: "number" },
  viewMode: { type: "string", description: "Common values: list, kanban, timeline." },
  kind: { type: "string", description: "Common value: TASK." },
  groupId: { type: "string" },
};

function validateDateFields(args = {}) {
  const errors = [];
  for (const field of ["startDate", "dueDate", "completedTime"]) {
    if (args[field] && !parseDate(args[field])) errors.push(`${field} must be a valid TickTick date-time, for example 2026-07-01T09:00:00+0300`);
  }
  if (args.startDate && args.dueDate) {
    const start = parseDate(args.startDate);
    const due = parseDate(args.dueDate);
    if (start && due && start > due) errors.push("startDate must be earlier than or equal to dueDate");
  }
  if (Array.isArray(args.items)) {
    args.items.forEach((item, index) => {
      for (const field of ["startDate", "completedTime"]) {
        if (item?.[field] && !parseDate(item[field])) errors.push(`items[${index}].${field} must be a valid TickTick date-time`);
      }
    });
  }
  return errors;
}

function pruneTaskPayload(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== ""));
}

export function officialTaskPayload(args = {}) {
  const payload = { ...args };
  if (payload.projectId) payload.projectId = apiProjectId(payload.projectId);
  return pruneTaskPayload(payload);
}

export const tools = [
  {
    name: "ticktick_auth_status",
    description: "Check whether TickTick OAuth or bearer-token auth is configured. Does not reveal secrets.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => redactAuth(loadAuth()),
  },
  {
    name: "ticktick_set_oauth_app",
    description: "Store TickTick developer app credentials for OAuth. Use only during private setup.",
    inputSchema: {
      type: "object",
      required: ["clientId", "clientSecret"],
      properties: {
        clientId: { type: "string" },
        clientSecret: { type: "string" },
        redirectUri: { type: "string" },
      },
    },
    handler: async (args) => {
      saveAuth({
        ...loadAuth(),
        clientId: args.clientId,
        clientSecret: args.clientSecret,
        redirectUri: args.redirectUri || loadAuth().redirectUri,
        scope: "tasks:read tasks:write",
      });
      return redactAuth(loadAuth());
    },
  },
  {
    name: "ticktick_get_auth_url",
    description: "Generate the TickTick OAuth URL to open once in a browser.",
    inputSchema: { type: "object", properties: { state: { type: "string" } } },
    handler: async (args) => buildAuthUrl(args),
  },
  {
    name: "ticktick_exchange_code",
    description: "Exchange a TickTick OAuth code or redirected URL for an access token and store it locally.",
    inputSchema: {
      type: "object",
      required: ["codeOrUrl"],
      properties: { codeOrUrl: { type: "string" } },
    },
    handler: async (args) => redactAuth(await exchangeAuthorizationCode(args.codeOrUrl)),
  },
  {
    name: "ticktick_set_bearer_token",
    description: "Store an existing TickTick bearer/API token directly, if the user already generated one.",
    inputSchema: {
      type: "object",
      required: ["token"],
      properties: {
        token: { type: "string" },
        refreshToken: { type: "string" },
        expiresAt: { type: "number", description: "Unix seconds expiration time, optional." },
      },
    },
    handler: async (args) => {
      saveAuth({
        ...loadAuth(),
        accessToken: args.token,
        refreshToken: args.refreshToken || loadAuth().refreshToken,
        tokenType: "Bearer",
        expiresAt: args.expiresAt || null,
      });
      return redactAuth(loadAuth());
    },
  },
  {
    name: "ticktick_clear_auth",
    description: "Remove stored TickTick auth data from this server.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      clearAuth();
      return { cleared: true };
    },
  },
  {
    name: "ticktick_list_projects",
    description: "List TickTick projects/lists, including Inbox as a pseudo-project.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => fetchProjects(),
  },
  {
    name: "ticktick_get_project",
    description: "Get a single TickTick project/list by project ID.",
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: { projectId: { type: "string" } },
    },
    handler: async (args) => ticktickRequest("GET", `/project/${encodeURIComponent(args.projectId)}`),
  },
  {
    name: "ticktick_create_project",
    description: "Create a TickTick project/list.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: projectFields,
    },
    handler: async (args) => ticktickRequest("POST", "/project", prune(args)),
  },
  {
    name: "ticktick_update_project",
    description: "Update a TickTick project/list by project ID.",
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: { projectId: { type: "string" }, ...projectFields },
    },
    handler: async (args) => {
      const { projectId, ...payload } = args;
      return ticktickRequest("POST", `/project/${encodeURIComponent(projectId)}`, prune(payload));
    },
  },
  {
    name: "ticktick_delete_project",
    description: "Delete a TickTick project/list by project ID. This is destructive.",
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: { projectId: { type: "string" } },
    },
    handler: async (args) => ticktickRequest("DELETE", `/project/${encodeURIComponent(args.projectId)}`),
  },
  {
    name: "ticktick_get_project_data",
    description: "Get a TickTick project/list with its active tasks, columns, and related project data.",
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: { projectId: { type: "string" } },
    },
    handler: async (args) => ticktickRequest("GET", `/project/${encodeURIComponent(apiProjectId(args.projectId))}/data`),
  },
  {
    name: "ticktick_get_task",
    description: "Get a single TickTick task by project ID and task ID.",
    inputSchema: {
      type: "object",
      required: ["projectId", "taskId"],
      properties: { projectId: { type: "string" }, taskId: { type: "string" } },
    },
    handler: async (args) => ticktickRequest("GET", `/project/${encodeURIComponent(apiProjectId(args.projectId))}/task/${encodeURIComponent(args.taskId)}`),
  },
  {
    name: "ticktick_list_tasks",
    description: "List active TickTick tasks across projects, optionally filtered by project, due bucket, tag, or text search.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        bucket: { type: "string", enum: ["overdue", "today", "next_7_days", "later", "no_due_date"] },
        tag: { type: "string" },
        search: { type: "string" },
        openOnly: { type: "boolean", default: true },
        limit: { type: "number" },
      },
    },
    handler: async (args) => filterTasks(await fetchAllTasks(args), args),
  },
  {
    name: "ticktick_filter_tasks_official",
    description: "Use TickTick's official /task/filter endpoint for project, date, priority, tag, and status filtering.",
    inputSchema: {
      type: "object",
      properties: {
        projectIds: { type: "array", items: { type: "string" } },
        startDate: { type: "string", description: "Inclusive start date-time for task startDate filtering." },
        endDate: { type: "string", description: "Inclusive end date-time for task startDate filtering." },
        priority: { type: "array", items: { type: "number" }, description: "Priority values: None 0, Low 1, Medium 3, High 5." },
        tag: { type: "array", items: { type: "string" }, description: "Tasks must contain all listed tags." },
        status: { type: "array", items: { type: "number" }, description: "Status values, for example open 0 or completed 2." },
        limit: { type: "number" },
      },
    },
    handler: async (args) => filterTasksOfficial(args),
  },
  {
    name: "ticktick_list_completed_tasks",
    description: "Use TickTick's official /task/completed endpoint to list completed tasks by project and completion time range.",
    inputSchema: {
      type: "object",
      properties: {
        projectIds: { type: "array", items: { type: "string" } },
        startDate: { type: "string", description: "Completion time range start." },
        endDate: { type: "string", description: "Completion time range end." },
        limit: { type: "number" },
      },
    },
    handler: async (args) => listCompletedTasks(args),
  },
  {
    name: "ticktick_search_tasks",
    description: "Search TickTick tasks across all projects and Inbox, returning ranked candidates with match reasons.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language text to match against title, content, tags, project, and checklist items." },
        projectId: { type: "string" },
        bucket: { type: "string", enum: ["overdue", "today", "next_7_days", "later", "no_due_date"] },
        tag: { type: "string" },
        openOnly: { type: "boolean", default: true },
        limit: { type: "number", default: 20 },
      },
    },
    handler: async (args) => searchTasks(args),
  },
  {
    name: "ticktick_find_task_candidates",
    description: "Find candidate tasks for a natural-language request and say whether an agent can safely act on one of them.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        projectId: { type: "string" },
        bucket: { type: "string", enum: ["overdue", "today", "next_7_days", "later", "no_due_date"] },
        tag: { type: "string" },
        openOnly: { type: "boolean", default: true },
        allowBestMatch: { type: "boolean", default: false },
        minScore: { type: "number", default: 45 },
        minScoreGap: { type: "number", default: 25 },
        limit: { type: "number", default: 10 },
      },
    },
    handler: async (args) => findTaskCandidates(args),
  },
  {
    name: "ticktick_today",
    description: "Return open TickTick tasks due today and overdue, plus a compact count summary.",
    inputSchema: {
      type: "object",
      properties: { includeNext7Days: { type: "boolean", default: false } },
    },
    handler: async (args) => {
      const tasks = await fetchAllTasks();
      const buckets = workloadSummary(tasks).buckets;
      const wanted = new Set(["overdue", "today"]);
      if (args.includeNext7Days) wanted.add("next_7_days");
      return {
        summary: buckets,
        tasks: filterTasks(tasks, { openOnly: true }).filter((task) => wanted.has(taskDueBucket(task))),
      };
    },
  },
  {
    name: "ticktick_analyze_workload",
    description: "Fetch active tasks and return counts by due bucket, priority, and project for planning.",
    inputSchema: {
      type: "object",
      properties: {
        includeTasks: { type: "boolean", default: true },
        limit: { type: "number", default: 40 },
      },
    },
    handler: async (args) => analyzeWorkload(args),
  },
  {
    name: "ticktick_overdue",
    description: "Return open overdue TickTick tasks across all projects and Inbox.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        tag: { type: "string" },
        openOnly: { type: "boolean", default: true },
        limit: { type: "number", default: 20 },
      },
    },
    handler: async (args) => listOverdueTasks(args),
  },
  {
    name: "ticktick_inbox",
    description: "Return TickTick Inbox tasks. Inbox is not returned by the normal /project endpoint, so this tool checks it explicitly.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string" },
        tag: { type: "string" },
        openOnly: { type: "boolean", default: true },
        limit: { type: "number", default: 20 },
      },
    },
    handler: async (args) => listInboxTasks(args),
  },
  {
    name: "ticktick_create_task",
    description: "Create a TickTick task. The official TickTick Open API requires projectId.",
    inputSchema: {
      type: "object",
      required: ["title", "projectId"],
      properties: taskFields,
    },
    validate: validateDateFields,
    handler: async (args) => ticktickRequest("POST", "/task", officialTaskPayload(args)),
  },
  {
    name: "ticktick_update_task",
    description: "Update a TickTick task by task ID. The official TickTick Open API requires projectId and the request body must include the task id.",
    inputSchema: {
      type: "object",
      required: ["taskId", "projectId"],
      properties: { taskId: { type: "string" }, ...taskFields },
    },
    validate: validateDateFields,
    handler: async (args) => {
      const { taskId, ...payload } = args;
      return ticktickRequest("POST", `/task/${encodeURIComponent(taskId)}`, officialTaskPayload({ ...payload, id: taskId }));
    },
  },
  {
    name: "ticktick_move_task",
    description: "Move a TickTick task to another project/list using the official /task/move endpoint.",
    inputSchema: {
      type: "object",
      required: ["taskId", "fromProjectId", "toProjectId"],
      properties: {
        taskId: { type: "string" },
        fromProjectId: { type: "string", description: "Source project ID from the task's current projectId." },
        toProjectId: { type: "string", description: "Destination project ID." },
        sourceProjectId: { type: "string", description: "Alias for fromProjectId." },
        targetProjectId: { type: "string", description: "Alias for toProjectId." },
      },
    },
    handler: async (args) => moveTask(args),
  },
  {
    name: "ticktick_complete_task",
    description: "Complete a TickTick task by project ID and task ID.",
    inputSchema: {
      type: "object",
      required: ["projectId", "taskId"],
      properties: { projectId: { type: "string" }, taskId: { type: "string" } },
    },
    handler: async (args) => ticktickRequest("POST", `/project/${encodeURIComponent(apiProjectId(args.projectId))}/task/${encodeURIComponent(args.taskId)}/complete`),
  },
  {
    name: "ticktick_complete_task_safe",
    description: "Complete a task only when exact IDs are provided or a natural-language query resolves to one safe candidate.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        taskId: { type: "string" },
        query: { type: "string" },
        bucket: { type: "string", enum: ["overdue", "today", "next_7_days", "later", "no_due_date"] },
        tag: { type: "string" },
        dryRun: { type: "boolean", default: false },
        allowBestMatch: { type: "boolean", default: false },
        minScore: { type: "number", default: 45 },
        minScoreGap: { type: "number", default: 25 },
        limit: { type: "number", default: 10 },
      },
    },
    handler: async (args) => completeTaskSafe(args),
  },
  {
    name: "ticktick_delete_task",
    description: "Delete a TickTick task by project ID and task ID. This is destructive.",
    inputSchema: {
      type: "object",
      required: ["projectId", "taskId"],
      properties: { projectId: { type: "string" }, taskId: { type: "string" } },
    },
    handler: async (args) => ticktickRequest("DELETE", `/project/${encodeURIComponent(apiProjectId(args.projectId))}/task/${encodeURIComponent(args.taskId)}`),
  },
  {
    name: "ticktick_diagnostics",
    description: "Run non-destructive diagnostics for auth, TickTick endpoint access, Inbox visibility, and task/project counts.",
    inputSchema: {
      type: "object",
      properties: {
        includeTaskCounts: { type: "boolean", default: true },
      },
    },
    handler: async (args) => runDiagnostics(args),
  },
  {
    name: "ticktick_list_focuses",
    description: "List TickTick Focus records in a time range. Type 0 is Pomodoro, type 1 is Timing. Ranges above 30 days may be adjusted by TickTick.",
    inputSchema: {
      type: "object",
      required: ["from", "to"],
      properties: {
        from: { type: "string", description: "Range start, for example 2026-04-01T00:00:00+0800." },
        to: { type: "string", description: "Range end, for example 2026-04-02T00:00:00+0800." },
        type: focusTypeSchema,
      },
    },
    handler: async (args) => listFocuses(args),
  },
  {
    name: "ticktick_get_focus",
    description: "Get a single TickTick Focus record by focus ID and focus type.",
    inputSchema: {
      type: "object",
      required: ["focusId"],
      properties: {
        focusId: { type: "string" },
        type: focusTypeSchema,
      },
    },
    handler: async (args) => getFocus(args),
  },
  {
    name: "ticktick_analyze_focus",
    description: "Summarize TickTick Focus/Pomodoro time by type for a time range.",
    inputSchema: {
      type: "object",
      required: ["from", "to"],
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        type: focusTypeSchema,
        includeSessions: { type: "boolean", default: true },
      },
    },
    handler: async (args) => analyzeFocus(args),
  },
  {
    name: "ticktick_delete_focus",
    description: "Delete a TickTick Focus record by focus ID and focus type. This is destructive.",
    inputSchema: {
      type: "object",
      required: ["focusId"],
      properties: {
        focusId: { type: "string" },
        type: focusTypeSchema,
      },
    },
    handler: async (args) => deleteFocus(args),
  },
  {
    name: "ticktick_list_habits",
    description: "List TickTick habits from the official Habit API.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => listHabits(),
  },
  {
    name: "ticktick_get_habit",
    description: "Get a single TickTick habit by habit ID.",
    inputSchema: {
      type: "object",
      required: ["habitId"],
      properties: { habitId: { type: "string" } },
    },
    handler: async (args) => getHabit(args),
  },
  {
    name: "ticktick_create_habit",
    description: "Create a TickTick habit with the official Habit API.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: habitFields,
    },
    handler: async (args) => createHabit(args),
  },
  {
    name: "ticktick_update_habit",
    description: "Update a TickTick habit by habit ID.",
    inputSchema: {
      type: "object",
      required: ["habitId"],
      properties: { habitId: { type: "string" }, ...habitFields },
    },
    handler: async (args) => updateHabit(args),
  },
  {
    name: "ticktick_checkin_habit",
    description: "Create or update a TickTick habit check-in for a date stamp.",
    inputSchema: {
      type: "object",
      required: ["habitId", "stamp"],
      properties: { habitId: { type: "string" }, ...habitCheckinFields },
    },
    handler: async (args) => checkInHabit(args),
  },
  {
    name: "ticktick_list_habit_checkins",
    description: "List TickTick habit check-ins for one or more habits over a date-stamp range.",
    inputSchema: {
      type: "object",
      required: ["habitIds", "from", "to"],
      properties: {
        habitIds: {
          oneOf: [
            { type: "array", items: { type: "string" } },
            { type: "string" },
          ],
          description: "Habit IDs as an array or comma-separated string.",
        },
        from: { type: "number", description: "Start date stamp in YYYYMMDD format." },
        to: { type: "number", description: "End date stamp in YYYYMMDD format." },
      },
    },
    handler: async (args) => listHabitCheckins(args),
  },
  {
    name: "ticktick_raw_request",
    description: "Advanced escape hatch for TickTick Open API paths not covered by dedicated tools.",
    inputSchema: {
      type: "object",
      required: ["method", "endpoint"],
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
        endpoint: { type: "string", description: "Path under /open/v1, for example /project." },
        body: { type: "object" },
        query: { type: "object" },
      },
    },
    handler: async (args) => ticktickRequest(args.method, args.endpoint, args.body, args.query),
  },
];

export const toolMap = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
