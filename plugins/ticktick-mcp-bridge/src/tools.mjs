import { clearAuth, loadAuth, redactAuth, saveAuth } from "./auth-store.mjs";
import {
  buildAuthUrl,
  exchangeAuthorizationCode,
  isOpenTask,
  prune,
  taskDueBucket,
  ticktickRequest,
} from "./ticktick-api.mjs";

export function projectNameById(projects) {
  return Object.fromEntries(projects.map((project) => [project.id, project.name || project.title || project.id]));
}

export const INBOX_PROJECT = {
  id: "inbox",
  name: "Inbox",
  viewMode: "list",
  kind: "TASK",
  isInbox: true,
};

export function withInboxProject(projects) {
  return projects.some((project) => String(project.id).toLowerCase() === "inbox")
    ? projects
    : [INBOX_PROJECT, ...projects];
}

export function isInboxProjectId(projectId) {
  return String(projectId || "").toLowerCase() === "inbox" || String(projectId || "").toLowerCase().startsWith("inbox");
}

export function apiProjectId(projectId) {
  return isInboxProjectId(projectId) ? "inbox" : projectId;
}

async function getAllTasks(args = {}) {
  const projects = withInboxProject(args.projects || await ticktickRequest("GET", "/project"));
  const projectNames = projectNameById(projects);
  const selected = args.projectId
    ? projects.filter((project) => project.id === args.projectId || (project.isInbox && isInboxProjectId(args.projectId)))
    : projects;
  const results = [];
  for (const project of selected) {
    const data = await ticktickRequest("GET", `/project/${encodeURIComponent(apiProjectId(project.id))}/data`);
    const tasks = data.tasks || data.taskList || [];
    for (const task of tasks) {
      results.push({
        ...task,
        projectId: task.projectId || project.id,
        projectName: projectNames[task.projectId || project.id] || project.name || project.title,
      });
    }
  }
  return results;
}

function filterTasks(tasks, args = {}) {
  let filtered = tasks;
  if (args.openOnly !== false) filtered = filtered.filter(isOpenTask);
  if (args.bucket) filtered = filtered.filter((task) => taskDueBucket(task) === args.bucket);
  if (args.tag) {
    const tag = String(args.tag).toLowerCase();
    filtered = filtered.filter((task) => (task.tags || []).map((x) => String(x).toLowerCase()).includes(tag));
  }
  if (args.search) {
    const needle = String(args.search).toLowerCase();
    filtered = filtered.filter((task) => `${task.title || ""} ${task.content || ""}`.toLowerCase().includes(needle));
  }
  filtered.sort((a, b) => {
    const aDue = Date.parse(String(a.dueDate || "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) || Number.MAX_SAFE_INTEGER;
    const bDue = Date.parse(String(b.dueDate || "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) || Number.MAX_SAFE_INTEGER;
    const dueCompare = aDue - bDue;
    if (dueCompare) return dueCompare;
    return Number(b.priority || 0) - Number(a.priority || 0);
  });
  return args.limit ? filtered.slice(0, Number(args.limit)) : filtered;
}

function workloadSummary(tasks) {
  const buckets = { overdue: 0, today: 0, next_7_days: 0, later: 0, no_due_date: 0 };
  const priorities = { none: 0, low: 0, medium: 0, high: 0 };
  const projects = {};
  for (const task of tasks.filter(isOpenTask)) {
    buckets[taskDueBucket(task)] += 1;
    const priority = Number(task.priority || 0);
    if (priority >= 5) priorities.high += 1;
    else if (priority >= 3) priorities.medium += 1;
    else if (priority >= 1) priorities.low += 1;
    else priorities.none += 1;
    const name = task.projectName || task.projectId || "Unknown";
    projects[name] = (projects[name] || 0) + 1;
  }
  return { buckets, priorities, projects, totalOpen: tasks.filter(isOpenTask).length };
}

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
    handler: async () => withInboxProject(await ticktickRequest("GET", "/project")),
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
    handler: async (args) => ticktickRequest("GET", `/project/${encodeURIComponent(args.projectId)}/task/${encodeURIComponent(args.taskId)}`),
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
    handler: async (args) => filterTasks(await getAllTasks(args), args),
  },
  {
    name: "ticktick_today",
    description: "Return open TickTick tasks due today and overdue, plus a compact count summary.",
    inputSchema: {
      type: "object",
      properties: { includeNext7Days: { type: "boolean", default: false } },
    },
    handler: async (args) => {
      const tasks = await getAllTasks();
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
    handler: async (args) => {
      const tasks = filterTasks(await getAllTasks(), { openOnly: true, limit: args.limit || 40 });
      return {
        generatedAt: new Date().toISOString(),
        summary: workloadSummary(tasks),
        tasks: args.includeTasks === false ? undefined : tasks,
      };
    },
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
    name: "ticktick_complete_task",
    description: "Complete a TickTick task by project ID and task ID.",
    inputSchema: {
      type: "object",
      required: ["projectId", "taskId"],
      properties: { projectId: { type: "string" }, taskId: { type: "string" } },
    },
    handler: async (args) => ticktickRequest("POST", `/project/${encodeURIComponent(args.projectId)}/task/${encodeURIComponent(args.taskId)}/complete`),
  },
  {
    name: "ticktick_delete_task",
    description: "Delete a TickTick task by project ID and task ID. This is destructive.",
    inputSchema: {
      type: "object",
      required: ["projectId", "taskId"],
      properties: { projectId: { type: "string" }, taskId: { type: "string" } },
    },
    handler: async (args) => ticktickRequest("DELETE", `/project/${encodeURIComponent(args.projectId)}/task/${encodeURIComponent(args.taskId)}`),
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
