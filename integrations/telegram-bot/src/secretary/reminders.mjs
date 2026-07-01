import { formatTask, getTasks } from "../formatters.mjs";

function parseDueDate(value) {
  if (!value) return null;
  const normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function effectiveLeadMinutes(config, profile = {}) {
  return Number(profile.reminderLeadMinutes || config.telegram.reminderLeadMinutes || 30);
}

export function buildReminderText({ items, leadMinutes, config }) {
  const lines = [
    "Upcoming reminders",
    `lead window: ${leadMinutes}m`,
  ];

  if (!items.length) {
    lines.push("No tasks with due/start time inside the reminder window.");
    return lines.join("\n");
  }

  lines.push(`count: ${items.length}`, "", "Tasks:");
  for (const { task, dueMs } of items.slice(0, config.telegram.maxResults)) {
    lines.push(`${formatTask(task)} at ${new Date(dueMs).toISOString()}`);
  }
  return lines.join("\n");
}

export function buildUpcomingReminders({ todayData, now = new Date() }, config, profile = {}) {
  const nowMs = now.getTime();
  const leadMinutes = effectiveLeadMinutes(config, profile);
  const windowEnd = nowMs + leadMinutes * 60 * 1000;
  const upcoming = getTasks(todayData)
    .map((task) => ({ task, dueMs: parseDueDate(task.dueDate || task.startDate) }))
    .filter(({ dueMs }) => dueMs && dueMs >= nowMs && dueMs <= windowEnd)
    .sort((a, b) => a.dueMs - b.dueMs);

  const text = buildReminderText({ items: upcoming, leadMinutes, config });
  if (!upcoming.length) {
    return {
      shouldNotify: false,
      count: 0,
      items: [],
      leadMinutes,
      text,
    };
  }

  return {
    shouldNotify: true,
    count: upcoming.length,
    items: upcoming,
    leadMinutes,
    text,
  };
}

export async function loadUpcomingReminders({ bridge, config, profile, now = new Date() }) {
  const todayData = await bridge.callTool("ticktick_today", { includeNext7Days: false });
  return buildUpcomingReminders({ todayData, now }, config, profile);
}
