import { clearAuth, loadAuth, redactAuth, saveAuth } from "./auth-store.mjs";
import {
  buildAuthUrl,
  exchangeAuthorizationCode,
  prune,
  taskDueBucket,
  ticktickRequest,
} from "./ticktick-api.mjs";
import { runDiagnostics } from "./diagnostics.mjs";
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
  listInboxTasks,
  listOverdueTasks,
  moveTask,
  searchTasks,
} from "./task-operations.mjs";

const taskFields = {
  id: { type: "string" },
  title: { type: "string" },
  content: { type: "string" },
  projectId: { type: "string" },
  dueDate: { type: "string", description: "Example: 2026-06-01T09:00:00+0000" },
  startDate: { type: "string" },
  timeZone: { type: "string" },
  isAllDay: { type: "boolean" },
  priority: { type: "number", description: "TickTick priority: 0 none, 1 low, 3 medium, 5 high." },
  tags: { type: "array", items: { type: "string" } },
  items: { type: "array", items: { type: "object" } },
  kind: { type: "string" },
  columnId: { type: "string" },
  sortOrder: { type: "number" },
};

const projectFields = {
  name: { type: "string" },
  color: { type: "string", description: "Hex color, e.g. #4772FA." },
  sortOrder: { type: "number" },
  viewMode: { type: "string", description: "Common values: list, kanban, timeline." },
  kind: { type: "string", description: "Common value: TASK." },
  groupId: { type: "string" },
};

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
    description: "Create a TickTick task. Use projectId to choose a list; omit it for TickTick default behavior.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: taskFields,
    },
    handler: async (args) => ticktickRequest("POST", "/task", prune(args)),
  },
  {
    name: "ticktick_update_task",
    description: "Update a TickTick task by task ID. Include fields to change, such as title, content, projectId, dueDate, priority, tags, or checklist items.",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string" }, ...taskFields },
    },
    handler: async (args) => {
      const { taskId, ...payload } = args;
      return ticktickRequest("POST", `/task/${encodeURIComponent(taskId)}`, prune(payload));
    },
  },
  {
    name: "ticktick_move_task",
    description: "Move a TickTick task to another project/list, optionally into a Kanban column.",
    inputSchema: {
      type: "object",
      required: ["taskId", "targetProjectId"],
      properties: {
        taskId: { type: "string" },
        targetProjectId: { type: "string" },
        columnId: { type: "string" },
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
