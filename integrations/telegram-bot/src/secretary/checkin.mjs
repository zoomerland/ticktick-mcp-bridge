import { formatTask, getTasks } from "../formatters.mjs";
import { analyzeScheduleShape } from "./proactive.mjs";
import {
  buildPostponeAllTodayAction,
  buildPostponeRestTodayAction,
  formatPostponeTodayAction,
  loadScheduleRepair,
} from "./repair.mjs";

const ON_TRACK_RE = /\b(on track|fine|ok|okay|good|all good|i am good|i'm good|normal)\b|РІСЃРµ РЅРѕСЂРј|РЅРѕСЂРјР°Р»|РІ РїРѕСЂСЏРґРєРµ|РёРґСѓ РїРѕ РїР»Р°РЅСѓ/i;
const TIRED_RE = /\b(tired|exhausted|low energy|no energy|need rest|need a rest|rest today|burned out|overloaded)\b|СѓСЃС‚Р°Р»|РЅРµС‚ СЃРёР»|РѕС‚РґРѕС…РЅ|РїРµСЂРµРіСЂСѓР¶|РІС‹РјРѕС‚Р°РЅ/i;
const ALL_TODAY_RE = /\b(cancel|clear|move|postpone|reschedule).*\b(today|today'?s plan|today plans|everything|all)\b|РѕС‚РјРµРЅ.*(СЃРµРіРѕРґРЅСЏ|РїР»Р°РЅ|РІСЃРµ|РІСЃС‘)|РїРµСЂРµРЅРµСЃ.*(РІСЃРµ|РІСЃС‘|СЃРµРіРѕРґРЅСЏ)/i;
const REST_TODAY_RE = /\b(leave|keep|protect|save).*\b(main|top|important|highest[- ]priority|focus)\b|\b(main|top|important|highest[- ]priority|focus)\b.*\b(leave|keep|protect|save)\b|\b(move|postpone|reschedule).*\b(rest|remaining|everything else)\b|РѕСЃС‚Р°РІ.*(РіР»Р°РІРЅ|РІР°Р¶РЅ)|Р·Р°С‰РёС‚.*(РіР»Р°РІРЅ|РІР°Р¶РЅ)|РїРµСЂРµРЅРµСЃ.*(РѕСЃС‚Р°Р»СЊРЅ|РїСЂРѕС‡)/i;
const LATE_RE = /\b(late|behind|not enough time|can't make it|cannot make it|running late|delay)\b|РЅРµ СѓСЃРїРµРІ|РѕРїР°Р·Рґ|РЅРµ СѓРєР»Р°РґС‹РІ|Р·Р°РґРµСЂР¶/i;

function countBucket(tasks, bucket) {
  return tasks.filter((task) => task.dueBucket === bucket).length;
}

function topTasks(tasks, limit = 3) {
  return tasks
    .slice()
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
    .slice(0, limit);
}

function classify({ todayTasks, inboxTasks, schedule }) {
  const overdueCount = countBucket(todayTasks, "overdue");
  const todayCount = countBucket(todayTasks, "today");

  if (overdueCount > 0) {
    return {
      status: "overdue",
      question: "I see overdue work. Should we protect the main item and move lower-priority work, or clear today more aggressively?",
    };
  }
  if (schedule.overloaded) {
    return {
      status: "dense",
      question: "The next part of the day looks dense. Are you still on track, or should I prepare a lighter plan?",
    };
  }
  if (schedule.untimedTodayCount > 0) {
    return {
      status: "untimed",
      question: "Some tasks for today have no concrete time. Should we place them, protect one focus item, or leave them flexible?",
    };
  }
  if (schedule.hasLargeOpenWindow) {
    const gap = schedule.nextGapMinutes;
    return {
      status: "open_window",
      question: gap
        ? `There is a ${gap}m open window before the next timed task. Use it for a useful block or keep it as rest?`
        : "The visible plan is light. Add a useful block or preserve rest?",
    };
  }
  if (inboxTasks.length > 0) {
    return {
      status: "inbox",
      question: "Inbox still needs triage. Should we clarify it now or keep today's plan unchanged?",
    };
  }
  if (todayCount === 0) {
    return {
      status: "light",
      question: "The visible day is clear. Do you want to preserve rest or add one intentional block?",
    };
  }
  return {
    status: "steady",
    question: "The visible plan looks steady. Are you on track?",
  };
}

export function resolveCheckinReply(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  if (ON_TRACK_RE.test(value)) return { action: "ack" };
  if (REST_TODAY_RE.test(value) || TIRED_RE.test(value)) return { action: "postpone_rest" };
  if (ALL_TODAY_RE.test(value)) return { action: "postpone_all" };
  if (LATE_RE.test(value)) return { action: "repair" };
  return null;
}

export function clearCheckinState(session, key) {
  return session?.clearPendingCheckin?.(key) || null;
}

export async function handleCheckinReply({ text, bridge, config, session, key }) {
  const pending = session?.getPendingCheckin?.(key);
  if (!pending) return null;

  const reply = resolveCheckinReply(text);
  if (!reply) return null;

  if (reply.action === "ack") {
    clearCheckinState(session, key);
    return {
      kind: "checkin_ack",
      text: "Check-in noted. I will keep the plan unchanged.",
    };
  }

  if (reply.action === "postpone_rest") {
    const todayData = await bridge.callTool("ticktick_today", { includeNext7Days: false });
    const action = buildPostponeRestTodayAction({ todayData, destination: "tomorrow", config });
    if (action.valid) session?.setPendingAction(key, action);
    else clearCheckinState(session, key);
    return {
      kind: action.valid ? "postpone_draft" : "postpone_review",
      tool: "ticktick_today",
      text: formatPostponeTodayAction(action),
    };
  }

  if (reply.action === "postpone_all") {
    const todayData = await bridge.callTool("ticktick_today", { includeNext7Days: false });
    const action = buildPostponeAllTodayAction({ todayData, destination: "tomorrow", config });
    if (action.valid) session?.setPendingAction(key, action);
    else clearCheckinState(session, key);
    return {
      kind: action.valid ? "postpone_draft" : "postpone_review",
      tool: "ticktick_today",
      text: formatPostponeTodayAction(action),
    };
  }

  if (reply.action === "repair") {
    clearCheckinState(session, key);
    return {
      kind: "schedule_repair",
      text: await loadScheduleRepair({ bridge, config, userText: text }),
    };
  }

  return null;
}

export function buildCheckinPrompt({ todayData, inboxData, now = new Date() }, config) {
  const todayTasks = getTasks(todayData);
  const inboxTasks = getTasks(inboxData);
  const schedule = analyzeScheduleShape(todayTasks, { now });
  const overdueCount = countBucket(todayTasks, "overdue");
  const todayCount = countBucket(todayTasks, "today");
  const decision = classify({ todayTasks, inboxTasks, schedule });
  const visibleTasks = topTasks(todayTasks, Math.min(config.telegram.maxResults, 3));

  const lines = [
    "Day check-in",
    `status: ${decision.status}`,
    `overdue: ${overdueCount}`,
    `today: ${todayCount}`,
    `inbox: ${inboxTasks.length}`,
  ];

  if (schedule.nextGapMinutes !== null) lines.push(`next open window: ${schedule.nextGapMinutes}m`);
  if (schedule.untimedTodayCount > 0) lines.push(`untimed today: ${schedule.untimedTodayCount}`);
  if (schedule.nearTimedCount > 0) lines.push(`timed in next 2h: ${schedule.nearTimedCount}`);

  lines.push("", `Question: ${decision.question}`);
  lines.push("", "Useful replies:");
  lines.push('- "I am on track"');
  lines.push('- "I am tired"');
  lines.push('- "leave only the main task"');
  lines.push('- "cancel today"');

  if (visibleTasks.length) {
    lines.push("", "Visible focus:");
    for (const task of visibleTasks) lines.push(formatTask(task));
  }

  return {
    kind: "checkin",
    status: decision.status,
    pending: {
      type: "checkin",
      status: decision.status,
      createdAt: now.toISOString(),
    },
    text: lines.join("\n"),
  };
}

export async function loadCheckin({ bridge, config, session, key, now = new Date() }) {
  const [todayData, inboxData] = await Promise.all([
    bridge.callTool("ticktick_today", { includeNext7Days: false }),
    bridge.callTool("ticktick_inbox", { limit: config.telegram.maxResults, openOnly: true }),
  ]);
  const checkin = buildCheckinPrompt({ todayData, inboxData, now }, config);
  if (session && key) session.setPendingCheckin(key, checkin.pending);
  return checkin;
}
