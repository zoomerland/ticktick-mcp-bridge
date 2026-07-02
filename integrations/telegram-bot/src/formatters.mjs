function truncate(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function priorityLabel(priority) {
  if (priority === 5) return "high";
  if (priority === 3) return "medium";
  if (priority === 1) return "low";
  return "none";
}

export function formatTask(task) {
  const parts = [truncate(task.title || "(untitled)")];
  if (task.projectName) parts.push(`[${truncate(task.projectName, 40)}]`);
  if (task.dueDate) parts.push(`due ${truncate(task.dueDate, 32)}`);
  if (task.priority) parts.push(`priority ${priorityLabel(task.priority)}`);
  return `- ${parts.join(" ")}`;
}

export function getTasks(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.tasks)) return data.tasks;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function getProjects(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.projects)) return data.projects;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function formatProject(project) {
  const id = project.id || project.projectId || "(unknown-id)";
  const name = project.name || project.title || (project.isInbox ? "Inbox" : "(unnamed)");
  return `- ${truncate(name, 80)} (${truncate(id, 80)})`;
}

function bucketLabel(bucket) {
  if (bucket === "overdue") return "Overdue";
  if (bucket === "today") return "Today";
  if (bucket === "next_7_days") return "Next 7 days";
  if (bucket === "later") return "Later";
  if (bucket === "no_due_date") return "No due date";
  return "Other";
}

export function formatBucketedTaskList(title, data, { maxResults = 10 } = {}) {
  const tasks = getTasks(data);
  const lines = [title];
  if (tasks.length === 0) {
    lines.push("No matching open tasks.");
    return lines.join("\n");
  }

  const buckets = new Map();
  for (const task of tasks.slice(0, maxResults)) {
    const bucket = task.dueBucket || "other";
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(task);
  }

  const order = ["overdue", "today", "next_7_days", "later", "no_due_date", "other"];
  for (const bucket of order) {
    const bucketTasks = buckets.get(bucket);
    if (!bucketTasks?.length) continue;
    lines.push(bucketLabel(bucket));
    for (const task of bucketTasks) lines.push(formatTask(task));
  }
  if (tasks.length > maxResults) lines.push(`...and ${tasks.length - maxResults} more.`);
  return lines.join("\n");
}

export function formatTaskList(title, data, { maxResults = 10 } = {}) {
  const tasks = getTasks(data);
  const lines = [title];
  if (tasks.length === 0) {
    lines.push("No matching open tasks.");
    return lines.join("\n");
  }

  for (const task of tasks.slice(0, maxResults)) lines.push(formatTask(task));
  if (tasks.length > maxResults) lines.push(`...and ${tasks.length - maxResults} more.`);
  return lines.join("\n");
}

export function formatProjectList(title, data, { maxResults = 10 } = {}) {
  const projects = getProjects(data);
  const lines = [title];
  if (projects.length === 0) {
    lines.push("No projects returned.");
    return lines.join("\n");
  }

  for (const project of projects.slice(0, maxResults)) lines.push(formatProject(project));
  if (projects.length > maxResults) lines.push(`...and ${projects.length - maxResults} more.`);
  return lines.join("\n");
}

export function formatDiagnostics(data) {
  const lines = ["Diagnostics"];
  if (data?.ok !== undefined) lines.push(`ok: ${data.ok}`);
  const checks = data?.checks || data || {};
  for (const [key, value] of Object.entries(checks)) {
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      lines.push(`${key}: ${value}`);
    }
  }
  if (Array.isArray(data?.warnings) && data.warnings.length) {
    lines.push(`warnings: ${data.warnings.join(", ")}`);
  }
  return lines.join("\n");
}

export function formatBridgeResult(command, data, config) {
  const maxResults = config.telegram.maxResults;
  if (command === "diagnostics") return formatDiagnostics(data);
  if (command === "today") return formatBucketedTaskList("Today and overdue", data, { maxResults });
  if (command === "overdue") return formatTaskList("Overdue", data, { maxResults });
  if (command === "projects") return formatProjectList("Projects", data, { maxResults });
  if (command === "inbox") return formatTaskList("Inbox", data, { maxResults });
  if (command === "search") return formatTaskList("Search results", data, { maxResults });
  return JSON.stringify(data, null, 2);
}
