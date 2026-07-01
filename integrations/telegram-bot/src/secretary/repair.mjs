import { formatTask, getTasks } from "../formatters.mjs";

const REPAIR_RE = /\b(late|delay|postpone|reschedule|cancel plans|cancel today|not enough time|can't make it)\b|не успева|опазд|перенес|перенос|сдвин|отмен.*план|отмени.*план|не могу.*сдел/i;
const POSTPONE_TOMORROW_RE = /\b(postpone|reschedule|move|shift).*\b(tomorrow|next day)\b|\b(tomorrow|next day)\b.*\b(postpone|reschedule|move|shift)\b|перенес.*завтра|завтра.*перенес|сдвин.*завтра|завтра.*сдвин/i;
const POSTPONE_ALL_TOMORROW_RE = /\b(cancel|clear|move|postpone|reschedule).*\b(all|everything|today'?s plans?|today plans|plans today)\b.*\b(tomorrow|next day)\b|\b(cancel|clear).*\b(today'?s plans?|today plans|plans today)\b|\b(move|postpone|reschedule).*\b(everything|all).*\b(tomorrow|next day)\b|отмен.*(план|дел).*(сегодня|на сегодня)|перенес.*(все|всё).*(завтра|на завтра)|сдвин.*(все|всё).*(завтра|на завтра)/i;
const POSTPONE_REST_TOMORROW_RE = /\b(keep|protect|save)\b.*\b(main|top|highest[- ]priority|highest priority|most important|priority item|priority task)\b|\b(highest[- ]priority|highest priority|main|top|most important)\b.*\b(keep|protect|save)\b|\b(reschedule|move|postpone|shift)\b.*\b(rest|remaining|others?|everything else)\b.*\b(tomorrow|next day)\b|\b(rest|remaining|others?|everything else)\b.*\b(tomorrow|next day)\b|остав.*(главн|важн)|защит.*(главн|важн)|сохран.*(главн|важн)|перенес.*(остальн|проч).*(завтра|на завтра)|(остальн|проч).*(завтра|на завтра).*перенес/i;

export function isScheduleRepairIntent(text) {
  return REPAIR_RE.test(String(text || "").toLowerCase());
}

export function isPostponeTomorrowIntent(text) {
  return POSTPONE_TOMORROW_RE.test(String(text || "").toLowerCase());
}

export function isPostponeAllTomorrowIntent(text) {
  return POSTPONE_ALL_TOMORROW_RE.test(String(text || "").toLowerCase());
}

export function isPostponeRestTomorrowIntent(text) {
  return POSTPONE_REST_TOMORROW_RE.test(String(text || "").toLowerCase());
}

function selectRepairCandidates(tasks, limit) {
  return tasks
    .slice()
    .sort((a, b) => {
      const bucketWeight = (task) => task.dueBucket === "overdue" ? 3 : task.dueBucket === "today" ? 2 : 1;
      return bucketWeight(b) - bucketWeight(a) || Number(b.priority || 0) - Number(a.priority || 0);
    })
    .slice(0, limit);
}

export function buildScheduleRepair({ todayData, userText }, config) {
  const tasks = getTasks(todayData);
  const candidates = selectRepairCandidates(tasks, Math.min(config.telegram.maxResults, 5));
  const overdue = tasks.filter((task) => task.dueBucket === "overdue").length;
  const today = tasks.filter((task) => task.dueBucket === "today").length;
  const lines = [
    "Schedule repair draft",
    `signal: ${userText}`,
    `overdue: ${overdue}`,
    `today: ${today}`,
    "",
  ];

  if (!tasks.length) {
    lines.push("I do not see dated open tasks to move. I should ask what changed before editing TickTick.");
    return lines.join("\n");
  }

  lines.push("Before changing TickTick, I would confirm one of these options:");
  lines.push("- move the selected task later today;");
  lines.push("- move lower-priority today tasks to tomorrow;");
  lines.push("- keep only the highest-priority item and reschedule the rest;");
  lines.push("- cancel today's plan and rebuild it from scratch.");

  lines.push("", "Visible candidates:");
  for (const task of candidates) lines.push(formatTask(task));

  lines.push("", "No changes have been written. Send a specific choice before I mutate TickTick.");
  return lines.join("\n");
}

export async function loadScheduleRepair({ bridge, config, userText }) {
  const todayData = await bridge.callTool("ticktick_today", { includeNext7Days: false });
  return buildScheduleRepair({ todayData, userText }, config);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function tomorrowAllDayDueDate(now = new Date()) {
  const next = new Date(now.getTime());
  next.setDate(next.getDate() + 1);
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}T00:00:00+0000`;
}

function postponableTodayTasks(todayData) {
  return getTasks(todayData).filter((task) => (
    task.dueBucket === "today"
    && Number(task.priority || 0) < 5
    && task.id
  ));
}

function todayTasks(todayData) {
  return getTasks(todayData).filter((task) => task.dueBucket === "today");
}

function allTodayTasks(todayData) {
  return todayTasks(todayData).filter((task) => task.id);
}

function priorityRank(task) {
  const priority = Number(task?.priority || 0);
  return Number.isFinite(priority) ? priority : 0;
}

function actionTaskSummary(task) {
  return {
    taskId: task.id,
    projectId: task.projectId,
    title: task.title,
    priority: task.priority,
  };
}

function buildPostponeAction({ tasks, dueDate, config, mode, reason, keptTasks = [], skippedTasks = [] }) {
  const updates = tasks.map((task) => ({
    taskId: task.id,
    projectId: task.projectId,
    title: task.title,
    priority: task.priority,
    dueDate,
    isAllDay: true,
    timeZone: config.telegram.defaultTimezone,
  }));

  return {
    type: "postpone_tasks",
    mode,
    valid: updates.length > 0,
    reason,
    destination: "tomorrow",
    kept: keptTasks.map(actionTaskSummary),
    skipped: skippedTasks.map(actionTaskSummary),
    updates,
  };
}

export function buildPostponeTodayAction({ todayData, destination, config, now = new Date() }) {
  const normalizedDestination = String(destination || "").trim().toLowerCase();
  if (!["tomorrow", "завтра"].includes(normalizedDestination)) {
    return {
      type: "postpone_tasks",
      mode: "lower_priority_today",
      valid: false,
      reason: "Only 'tomorrow' is supported for this first repair gate.",
      updates: [],
    };
  }

  const dueDate = tomorrowAllDayDueDate(now);
  const action = buildPostponeAction({
    tasks: postponableTodayTasks(todayData),
    dueDate,
    config,
    mode: "lower_priority_today",
    reason: "Move non-high-priority tasks due today to tomorrow.",
  });
  if (!action.valid) action.reason = "No non-high-priority tasks due today were found.";
  return action;
}

export function buildPostponeAllTodayAction({ todayData, destination, config, now = new Date() }) {
  const normalizedDestination = String(destination || "").trim().toLowerCase();
  if (!["tomorrow", "завтра"].includes(normalizedDestination)) {
    return {
      type: "postpone_tasks",
      mode: "all_today",
      valid: false,
      reason: "Only 'tomorrow' is supported for this all-day repair gate.",
      updates: [],
    };
  }

  const action = buildPostponeAction({
    tasks: allTodayTasks(todayData),
    dueDate: tomorrowAllDayDueDate(now),
    config,
    mode: "all_today",
    reason: "Move all tasks due today to tomorrow.",
  });
  if (!action.valid) action.reason = "No tasks due today were found.";
  return action;
}

export function buildPostponeRestTodayAction({ todayData, destination, config, now = new Date() }) {
  const normalizedDestination = String(destination || "").trim().toLowerCase();
  if (!["tomorrow", "завтра"].includes(normalizedDestination)) {
    return {
      type: "postpone_tasks",
      mode: "rest_today",
      valid: false,
      reason: "Only 'tomorrow' is supported for this protected-focus repair gate.",
      destination: "tomorrow",
      kept: [],
      skipped: [],
      updates: [],
    };
  }

  const tasks = todayTasks(todayData);
  if (!tasks.length) {
    return {
      type: "postpone_tasks",
      mode: "rest_today",
      valid: false,
      reason: "No tasks due today were found.",
      destination: "tomorrow",
      kept: [],
      skipped: [],
      updates: [],
    };
  }

  const topRank = Math.max(...tasks.map(priorityRank));
  const keptTasks = tasks.filter((task) => priorityRank(task) === topRank);
  const lowerPriorityTasks = tasks.filter((task) => priorityRank(task) < topRank);
  const movableTasks = lowerPriorityTasks.filter((task) => task.id);
  const skippedTasks = lowerPriorityTasks.filter((task) => !task.id);
  const action = buildPostponeAction({
    tasks: movableTasks,
    dueDate: tomorrowAllDayDueDate(now),
    config,
    mode: "rest_today",
    reason: `Keep ${keptTasks.length} top-priority today task(s); move the rest of today to tomorrow.`,
    keptTasks,
    skippedTasks,
  });

  if (!action.valid) {
    action.reason = lowerPriorityTasks.length
      ? "No lower-priority today tasks with IDs were found to move."
      : "All today tasks share the highest priority; nothing lower-priority is ready to move.";
  }
  return action;
}

export function formatPostponeTodayAction(action) {
  const lines = [
    "Postpone today draft",
    `reason: ${action.reason}`,
  ];

  if (action.kept?.length) {
    lines.push(`kept: ${action.kept.length}`);
    lines.push("", "Kept today:");
    for (const kept of action.kept) {
      lines.push(`- ${kept.title || kept.taskId} (priority ${priorityRank(kept)})`);
    }
  }

  if (!action.valid) {
    if (action.skipped?.length) lines.push(`skipped without IDs: ${action.skipped.length}`);
    lines.push("No changes are ready.");
    return lines.join("\n");
  }

  lines.push(`destination: ${action.destination}`);
  if (action.mode) lines.push(`mode: ${action.mode}`);
  lines.push(`updates: ${action.updates.length}`);
  lines.push("", "Tasks to move:");
  for (const update of action.updates) {
    lines.push(`- ${update.title || update.taskId} -> ${update.dueDate}`);
  }
  lines.push("", "Send /confirm to update TickTick, or /cancel.");
  return lines.join("\n");
}

export function formatPostponeResult(results) {
  const lines = [
    "Schedule updated.",
    `updated: ${results.length}`,
  ];
  for (const result of results) {
    lines.push(`- ${result.taskId || result.id || "(unknown task)"}`);
  }
  return lines.join("\n");
}
