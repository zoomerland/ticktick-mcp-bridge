import { isOpenTask, parseDate, taskDueBucket, ticktickRequest } from "./ticktick-api.mjs";

export const INBOX_PROJECT = {
  id: "inbox",
  name: "Inbox",
  viewMode: "list",
  kind: "TASK",
  isInbox: true,
};

export function projectNameById(projects) {
  return Object.fromEntries(projects.map((project) => [project.id, project.name || project.title || project.id]));
}

export function withInboxProject(projects) {
  return projects.some((project) => String(project.id).toLowerCase() === "inbox")
    ? projects.map(normalizeProject)
    : [INBOX_PROJECT, ...projects.map(normalizeProject)];
}

export function isInboxProjectId(projectId) {
  const value = String(projectId || "").toLowerCase();
  return value === "inbox" || value.startsWith("inbox");
}

export function apiProjectId(projectId) {
  return isInboxProjectId(projectId) ? "inbox" : projectId;
}

export function normalizeProject(project = {}) {
  const id = project.id || INBOX_PROJECT.id;
  return {
    ...project,
    id,
    name: project.name || project.title || (isInboxProjectId(id) ? "Inbox" : id),
    isInbox: Boolean(project.isInbox || isInboxProjectId(id)),
  };
}

export function normalizeProjectData(data = {}, project = {}) {
  const normalizedProject = normalizeProject(data.project || project);
  const tasks = data.tasks || data.taskList || [];
  return {
    ...data,
    project: normalizedProject,
    tasks: tasks.map((task) => normalizeTask(task, normalizedProject)),
    columns: data.columns || [],
  };
}

export function normalizeTask(task = {}, project = {}) {
  const normalizedProject = normalizeProject(project);
  const projectId = task.projectId || normalizedProject.id;
  const due = parseDate(task.dueDate);
  const start = parseDate(task.startDate);
  const schedule = due || start;
  const priority = Number(task.priority || 0);
  return {
    ...task,
    id: task.id,
    title: task.title || "",
    content: task.content || "",
    desc: task.desc || task.content || "",
    projectId,
    apiProjectId: apiProjectId(projectId),
    projectName: task.projectName || normalizedProject.name,
    status: task.status,
    isOpen: isOpenTask(task),
    dueDate: task.dueDate,
    startDate: task.startDate,
    dueTimestamp: due ? due.getTime() : null,
    startTimestamp: start ? start.getTime() : null,
    scheduleTimestamp: schedule ? schedule.getTime() : null,
    dueBucket: taskDueBucket(task),
    timeZone: task.timeZone,
    isAllDay: Boolean(task.isAllDay),
    priority,
    priorityLabel: priority >= 5 ? "high" : priority >= 3 ? "medium" : priority >= 1 ? "low" : "none",
    tags: Array.isArray(task.tags) ? task.tags : [],
    items: Array.isArray(task.items) ? task.items : [],
    reminders: Array.isArray(task.reminders) ? task.reminders : [],
    repeatFlag: task.repeatFlag,
    kind: task.kind,
    columnId: task.columnId,
  };
}

export async function fetchProjects() {
  return withInboxProject(await ticktickRequest("GET", "/project"));
}

export async function fetchProjectData(projectIdOrProject) {
  const project = typeof projectIdOrProject === "object"
    ? normalizeProject(projectIdOrProject)
    : normalizeProject({ id: projectIdOrProject });
  const data = await ticktickRequest("GET", `/project/${encodeURIComponent(apiProjectId(project.id))}/data`);
  return normalizeProjectData(data, project);
}

export async function fetchAllTasks(args = {}) {
  const projects = withInboxProject(args.projects || await ticktickRequest("GET", "/project"));
  const selected = args.projectId
    ? projects.filter((project) => project.id === args.projectId || (project.isInbox && isInboxProjectId(args.projectId)))
    : projects;
  const results = [];
  for (const project of selected) {
    const data = await fetchProjectData(project);
    results.push(...data.tasks);
  }
  return results;
}

export function filterTasks(tasks, args = {}) {
  let filtered = tasks;
  if (args.openOnly !== false) filtered = filtered.filter((task) => task.isOpen ?? isOpenTask(task));
  if (args.bucket) filtered = filtered.filter((task) => (task.dueBucket || taskDueBucket(task)) === args.bucket);
  if (args.tag) {
    const tag = String(args.tag).toLowerCase();
    filtered = filtered.filter((task) => (task.tags || []).map((x) => String(x).toLowerCase()).includes(tag));
  }
  if (args.search) {
    const needle = String(args.search).toLowerCase();
    filtered = filtered.filter((task) => taskSearchText(task).includes(needle));
  }
  return sortTasks(filtered).slice(0, args.limit ? Number(args.limit) : undefined);
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const aParsedDue = a.scheduleTimestamp ?? a.dueTimestamp ?? Date.parse(String(a.dueDate || a.startDate || "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    const bParsedDue = b.scheduleTimestamp ?? b.dueTimestamp ?? Date.parse(String(b.dueDate || b.startDate || "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    const aDue = Number.isFinite(aParsedDue) ? aParsedDue : Number.MAX_SAFE_INTEGER;
    const bDue = Number.isFinite(bParsedDue) ? bParsedDue : Number.MAX_SAFE_INTEGER;
    const dueCompare = aDue - bDue;
    if (dueCompare) return dueCompare;
    return Number(b.priority || 0) - Number(a.priority || 0);
  });
}

export function workloadSummary(tasks) {
  const buckets = { overdue: 0, today: 0, next_7_days: 0, later: 0, no_due_date: 0 };
  const priorities = { none: 0, low: 0, medium: 0, high: 0 };
  const projects = {};
  const openTasks = tasks.filter((task) => task.isOpen ?? isOpenTask(task));
  for (const task of openTasks) {
    buckets[task.dueBucket || taskDueBucket(task)] += 1;
    const priority = Number(task.priority || 0);
    if (priority >= 5) priorities.high += 1;
    else if (priority >= 3) priorities.medium += 1;
    else if (priority >= 1) priorities.low += 1;
    else priorities.none += 1;
    const name = task.projectName || task.projectId || "Unknown";
    projects[name] = (projects[name] || 0) + 1;
  }
  return { buckets, priorities, projects, totalOpen: openTasks.length, total: tasks.length };
}

export function taskSearchText(task) {
  return [
    task.title,
    task.content,
    task.desc,
    task.projectName,
    ...(task.tags || []),
    ...(task.items || []).map((item) => item.title || item.content || ""),
  ].join(" ").toLowerCase();
}
