import { formatTask, getTasks } from "../formatters.mjs";

function countBucket(tasks, bucket) {
  return tasks.filter((task) => task.dueBucket === bucket).length;
}

function topTasks(tasks, limit) {
  return tasks
    .slice()
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
    .slice(0, limit);
}

export function buildDailyBrief({ todayData, inboxData }, config) {
  const todayTasks = getTasks(todayData);
  const inboxTasks = getTasks(inboxData);
  const overdue = countBucket(todayTasks, "overdue");
  const dueToday = countBucket(todayTasks, "today");
  const maxResults = Math.min(config.telegram.maxResults, 5);

  const lines = [
    "Daily brief",
    `overdue: ${overdue}`,
    `today: ${dueToday}`,
    `inbox: ${inboxTasks.length}`,
    "",
  ];

  if (overdue > 0) {
    lines.push("Suggested focus: clear or reschedule overdue items first.");
  } else if (dueToday > 0) {
    lines.push("Suggested focus: pick the next concrete task for today.");
  } else if (inboxTasks.length > 0) {
    lines.push("Suggested focus: triage Inbox before adding new commitments.");
  } else {
    lines.push("Suggested focus: the visible plan is light; consider rest or a small planned block.");
  }

  const visibleTasks = topTasks(todayTasks, maxResults);
  if (visibleTasks.length) {
    lines.push("", "Top visible tasks:");
    for (const task of visibleTasks) lines.push(formatTask(task));
  }

  if (inboxTasks.length) {
    lines.push("", "Inbox needs clarification:");
    for (const task of inboxTasks.slice(0, Math.min(inboxTasks.length, 3))) lines.push(formatTask(task));
  }

  return lines.join("\n");
}

export async function loadDailyBrief({ bridge, config }) {
  const [todayData, inboxData] = await Promise.all([
    bridge.callTool("ticktick_today", { includeNext7Days: false }),
    bridge.callTool("ticktick_inbox", { limit: config.telegram.maxResults, openOnly: true }),
  ]);
  return buildDailyBrief({ todayData, inboxData }, config);
}
