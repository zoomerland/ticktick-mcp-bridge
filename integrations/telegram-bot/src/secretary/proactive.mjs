import { getTasks, formatTask } from "../formatters.mjs";

function count(tasks, predicate) {
  return tasks.filter(predicate).length;
}

function highestPriority(tasks) {
  return tasks
    .slice()
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0] || null;
}

function sameTask(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return a.title === b.title && (a.dueDate || a.startDate || "") === (b.dueDate || b.startDate || "");
}

function parseTaskDate(value) {
  if (!value) return null;
  const normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function minutesBetween(startMs, endMs) {
  return Math.max(0, Math.floor((endMs - startMs) / 60000));
}

function hourInWindow(hour, window) {
  if (window.startHour === window.endHour) return true;
  return window.startHour > window.endHour
    ? hour >= window.startHour || hour < window.endHour
    : hour >= window.startHour && hour < window.endHour;
}

export function analyzeScheduleShape(tasks, { now = new Date() } = {}) {
  const nowMs = now.getTime();
  const todayTasks = tasks.filter((task) => task.dueBucket === "today");
  const timedToday = todayTasks
    .map((task) => ({ task, atMs: parseTaskDate(task.startDate || task.dueDate) }))
    .filter(({ atMs }) => atMs)
    .sort((a, b) => a.atMs - b.atMs);
  const upcomingTimed = timedToday.filter(({ atMs }) => atMs >= nowMs);
  const nextTimed = upcomingTimed[0] || null;
  const nextGapMinutes = nextTimed ? minutesBetween(nowMs, nextTimed.atMs) : null;
  const nearTimedCount = upcomingTimed.filter(({ atMs }) => minutesBetween(nowMs, atMs) <= 120).length;
  const untimedTodayCount = todayTasks.length - timedToday.length;
  const highPriorityTodayCount = todayTasks.filter((task) => Number(task.priority || 0) >= 5).length;
  const overloaded = todayTasks.length >= 6 || nearTimedCount >= 3 || highPriorityTodayCount >= 3;
  const hasLargeOpenWindow = nextGapMinutes !== null
    ? nextGapMinutes >= 90
    : todayTasks.length <= 2;

  return {
    timedTodayCount: timedToday.length,
    untimedTodayCount,
    nearTimedCount,
    highPriorityTodayCount,
    overloaded,
    hasLargeOpenWindow,
    nextGapMinutes,
    nextTask: nextTimed?.task || null,
  };
}

export function buildProactiveReview({ todayData, inboxData, now = new Date() }, config) {
  const todayTasks = getTasks(todayData);
  const inboxTasks = getTasks(inboxData);
  const overdueCount = count(todayTasks, (task) => task.dueBucket === "overdue");
  const todayCount = count(todayTasks, (task) => task.dueBucket === "today");
  const highPriority = highestPriority(todayTasks);
  const topItem = Number(highPriority?.priority || 0) >= 5 ? highPriority : null;
  const quietHours = config.telegram.quietHours || { startHour: 23, endHour: 8 };
  const checkinHours = config.telegram.checkinHours || { startHour: 9, endHour: 21 };
  const hour = now.getHours();
  const inQuietHours = hourInWindow(hour, quietHours);
  const inCheckinHours = hourInWindow(hour, checkinHours);
  const schedule = analyzeScheduleShape(todayTasks, { now });
  const lines = ["Proactive review"];

  if (inQuietHours) {
    lines.push("Quiet-hours note: avoid non-urgent nudges now.");
  }
  if (!inCheckinHours) {
    lines.push("Check-in window note: wait until the configured initiative window.");
  }

  if (overdueCount > 0) {
    lines.push(`You have ${overdueCount} overdue item(s). I should suggest clearing or rescheduling them.`);
  } else if (schedule.overloaded) {
    lines.push("The next part of the day looks dense. I should ask whether to protect the critical items and move lower-priority work.");
  } else if (todayCount === 0 && inboxTasks.length === 0) {
    lines.push("The visible plan is light. I can suggest rest or a small planned block.");
  } else if (schedule.hasLargeOpenWindow) {
    if (schedule.nextTask && schedule.nextGapMinutes !== null) {
      lines.push(`There is a ${schedule.nextGapMinutes}m open window before the next timed task. I can ask whether to add a useful block or preserve rest.`);
    } else {
      lines.push("There is visible free capacity. I can ask whether to add a useful block or preserve rest.");
    }
  } else {
    lines.push("The day has enough visible commitments. I should avoid adding pressure.");
  }

  if (schedule.nearTimedCount >= 2) {
    lines.push(`Near-term density: ${schedule.nearTimedCount} timed item(s) in the next 2 hours.`);
  }
  if (schedule.untimedTodayCount > 0) {
    lines.push(`Untimed today items: ${schedule.untimedTodayCount}. I may need to ask when they should happen.`);
  }

  if (topItem) {
    lines.push("", "Top item to mention:");
    lines.push(formatTask(topItem));
  }
  if (schedule.nextTask && !sameTask(schedule.nextTask, topItem)) {
    lines.push("", "Next timed item:");
    lines.push(formatTask(schedule.nextTask));
  }
  if (inboxTasks.length) {
    lines.push("", `Inbox has ${inboxTasks.length} item(s) needing triage.`);
  }

  return {
    shouldNotify: !inQuietHours && inCheckinHours && (
      overdueCount > 0
      || schedule.overloaded
      || schedule.hasLargeOpenWindow
      || inboxTasks.length > 0
      || schedule.untimedTodayCount > 0
    ),
    reasons: {
      overdueCount,
      todayCount,
      inboxCount: inboxTasks.length,
      inQuietHours,
      inCheckinHours,
      timedTodayCount: schedule.timedTodayCount,
      untimedTodayCount: schedule.untimedTodayCount,
      nearTimedCount: schedule.nearTimedCount,
      nextGapMinutes: schedule.nextGapMinutes,
      overloaded: schedule.overloaded,
      hasLargeOpenWindow: schedule.hasLargeOpenWindow,
    },
    text: lines.join("\n"),
  };
}

export async function loadProactiveInputs({ bridge, config }) {
  const [todayData, inboxData] = await Promise.all([
    bridge.callTool("ticktick_today", { includeNext7Days: false }),
    bridge.callTool("ticktick_inbox", { limit: config.telegram.maxResults, openOnly: true }),
  ]);
  return { todayData, inboxData };
}
