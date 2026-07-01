import { formatTask, getTasks } from "../formatters.mjs";

function decisionText(decision = {}) {
  if (decision.status === "single_candidate") return "one matching task found";
  if (decision.status === "best_match") return decision.reason || "best matching task found";
  return decision.reason || "cannot safely choose one task";
}

export function buildCompleteAction(candidateResult, query) {
  const decision = candidateResult?.decision || {};
  if (!decision.canAct) return null;
  const tasks = getTasks(candidateResult);
  const selected = tasks.find((task) => task.id === decision.taskId) || tasks[0] || null;
  return {
    type: "complete_task",
    query,
    projectId: decision.projectId,
    taskId: decision.taskId,
    selected,
    reason: decision.status,
  };
}

export function formatCompleteCandidates(candidateResult, query) {
  const tasks = getTasks(candidateResult);
  const decision = candidateResult?.decision || {};
  const lines = [
    "Complete task review",
    `query: ${query}`,
    `decision: ${decision.status || "unknown"}`,
    `reason: ${decisionText(decision)}`,
  ];

  if (!tasks.length) {
    lines.push("", "No matching open task found.");
    return lines.join("\n");
  }

  lines.push("", "Candidates:");
  for (const task of tasks.slice(0, 5)) lines.push(formatTask(task));
  if (tasks.length > 5) lines.push(`...and ${tasks.length - 5} more.`);
  lines.push("", "No task was completed. Narrow the query or use an exact task title.");
  return lines.join("\n");
}

export function formatCompleteAction(action) {
  const lines = [
    "Complete task draft",
    `reason: ${action.reason}`,
  ];
  if (action.selected) lines.push(formatTask(action.selected));
  lines.push("", "Send /confirm to complete it, or /cancel.");
  return lines.join("\n");
}

export function formatTaskCompleted(result) {
  return [
    "Task completed.",
    `projectId: ${result.projectId || "(unknown)"}`,
    `taskId: ${result.taskId || "(unknown)"}`,
    `acted: ${result.acted === true}`,
  ].join("\n");
}
