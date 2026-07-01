import { effectiveProjectRoutes } from "./profile.mjs";

const TRAVEL_RE = /\b(trip|drive|go to|visit|appointment|doctor|clinic|hospital)\b|поезд|поех|ехать|добрат|доктор|врач|клиник|больниц/i;
const TIME_RE = /\b(\d{1,2}:\d{2}|\d{1,2}\s?(am|pm)|tomorrow|today|tonight)\b|завтра|сегодня|вечер|утр|днем|днём|ноч/i;
const DURATION_RE = /\b(\d+)\s?(m|min|minute|minutes|h|hr|hour|hours)\b|час|минут|полчас/i;
const LOCATION_RE = /\b(from|at|near)\b|из |от |куда|адрес|метро|район/i;
const UNKNOWN_DURATION_RE = /\b(i do not know|i don't know|unknown|not sure|no idea|hard to say)\b/i;
const TIME_OF_DAY_RE = /\b(morning|afternoon|evening|night|tonight|noon|midday)\b/i;
const CLOCK_24H_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;
const TODAY_RE = /\btoday\b|сегодня/i;
const TOMORROW_RE = /\btomorrow\b|завтра/i;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateWithOffset(now, dayOffset) {
  const date = new Date(now.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date;
}

function formatTickTickDueDate(date, hour = 0, minute = 0) {
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `T${pad2(hour)}:${pad2(minute)}:00+0000`,
  ].join("");
}

function normalizeTitle(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
}

function hasTimeOfDayHint(text) {
  return CLOCK_24H_RE.test(text) || TIME_OF_DAY_RE.test(text);
}

function buildTravelEstimate({ config, hasDurationHint, hasLocationHint, hasUnknownDuration, hasTimeOfDay }) {
  if (hasDurationHint || !hasUnknownDuration || !hasLocationHint || !hasTimeOfDay) return null;
  const baseMinutes = Math.max(1, Number(config.telegram.travelDefaultMinutes || 45));
  const bufferMinutes = Math.max(0, Number(config.telegram.travelBufferMinutes || 0));
  return {
    baseMinutes,
    bufferMinutes,
    reserveMinutes: baseMinutes + bufferMinutes,
    basis: "local_default",
    externalContextChecked: false,
  };
}

export function matchProjectRoute(title, config, profile = {}) {
  const normalizedTitle = String(title || "").toLowerCase();
  return effectiveProjectRoutes(profile, config).find((route) => normalizedTitle.includes(route.keyword)) || null;
}

export function inferTaskDueDate(text, config, { now = new Date() } = {}) {
  const source = String(text || "");
  const clock = source.match(CLOCK_24H_RE);
  const hasTomorrow = TOMORROW_RE.test(source);
  const hasToday = TODAY_RE.test(source);
  if (!clock && !hasTomorrow && !hasToday) return null;

  const dayOffset = hasTomorrow ? 1 : 0;
  const date = dateWithOffset(now, dayOffset);
  const hour = clock ? Number.parseInt(clock[1], 10) : 0;
  const minute = clock ? Number.parseInt(clock[2], 10) : 0;
  const isAllDay = !clock;
  const time = clock ? `${pad2(hour)}:${pad2(minute)}` : "";

  return {
    dueDate: formatTickTickDueDate(date, hour, minute),
    isAllDay,
    timeZone: config.telegram.defaultTimezone,
    day: hasTomorrow ? "tomorrow" : "today",
    time,
  };
}

export function analyzeTaskDraft(text, config, profile = {}, options = {}) {
  const title = normalizeTitle(text);
  const lower = title.toLowerCase();
  const isTravelLike = TRAVEL_RE.test(lower);
  const hasTimeHint = TIME_RE.test(lower);
  const hasTimeOfDay = hasTimeOfDayHint(lower);
  const hasDurationHint = DURATION_RE.test(lower);
  const hasLocationHint = LOCATION_RE.test(lower);
  const hasUnknownDuration = UNKNOWN_DURATION_RE.test(lower);
  const projectRoute = matchProjectRoute(title, config, profile);
  const inferredDue = inferTaskDueDate(title, config, options);
  const travelEstimate = isTravelLike
    ? buildTravelEstimate({ config, hasDurationHint, hasLocationHint, hasUnknownDuration, hasTimeOfDay })
    : null;
  const questions = [];

  if (isTravelLike && !hasDurationHint && !travelEstimate && !hasUnknownDuration) {
    questions.push("How long should I reserve for the trip itself?");
  }
  if (isTravelLike && !hasDurationHint && !travelEstimate && hasUnknownDuration && !hasLocationHint) {
    questions.push("From where to where should I estimate travel time?");
  }
  if (isTravelLike && !hasDurationHint && !travelEstimate && hasUnknownDuration && !hasTimeOfDay) {
    questions.push("What time of day should I estimate for travel?");
  }
  if (isTravelLike && !hasDurationHint && !travelEstimate && !hasUnknownDuration && !hasLocationHint) {
    questions.push("If you do not know the travel time, from where to where should I estimate it?");
  }
  if (!hasTimeHint) {
    questions.push("When should this happen?");
  }
  if (config.telegram.requireProjectForCreation && !config.telegram.defaultProjectId && !projectRoute) {
    questions.push("Which TickTick list/project should this go to?");
  }

  return {
    title,
    sourceText: text,
    signals: {
      travelLike: isTravelLike,
      hasTimeHint,
      hasTimeOfDay,
      hasDurationHint,
      hasLocationHint,
      hasUnknownDuration,
      hasDueDate: Boolean(inferredDue),
      hasTravelEstimate: Boolean(travelEstimate),
    },
    dueDate: inferredDue?.dueDate,
    isAllDay: inferredDue?.isAllDay,
    timeZone: inferredDue?.timeZone,
    inferredDue,
    travelEstimate,
    projectRoute,
    questions,
    canCreateNow: questions.length === 0,
  };
}

export function refineTaskDraft(previousDraft, text, config, profile = {}, options = {}) {
  const answer = normalizeTitle(text);
  if (!previousDraft) return analyzeTaskDraft(answer, config, profile, options);
  const combined = [
    previousDraft.title,
    previousDraft.notes ? `notes: ${previousDraft.notes}` : "",
    answer ? `answer: ${answer}` : "",
  ].filter(Boolean).join(" | ");
  const draft = analyzeTaskDraft(combined, config, profile, options);
  return {
    ...draft,
    title: previousDraft.title,
    sourceText: previousDraft.sourceText || previousDraft.title,
    notes: [previousDraft.notes, answer].filter(Boolean).join(" | "),
  };
}

export function buildCreateTaskArgs(draft, config) {
  const args = { title: draft.title };
  const content = [];
  if (draft.notes) content.push(draft.notes);
  if (draft.travelEstimate) {
    content.push([
      `travel estimate: ${draft.travelEstimate.reserveMinutes} minutes`,
      `basis: ${draft.travelEstimate.basis}`,
      "external context checked: false",
    ].join("\n"));
  }
  if (content.length) args.content = content.join("\n\n");
  if (draft.projectRoute?.projectId) {
    args.projectId = draft.projectRoute.projectId;
  } else if (config.telegram.defaultProjectId) {
    args.projectId = config.telegram.defaultProjectId;
  }
  if (draft.dueDate) {
    args.dueDate = draft.dueDate;
    args.timeZone = draft.timeZone || config.telegram.defaultTimezone;
    args.isAllDay = Boolean(draft.isAllDay);
  }
  return args;
}

export function formatTaskCreated(task) {
  const id = task?.id || task?.taskId || "(unknown id)";
  const title = task?.title || "(untitled)";
  return [
    "Task created.",
    `title: ${title}`,
    `id: ${id}`,
  ].join("\n");
}

export function formatTaskDraft(draft) {
  const lines = [
    "Task draft",
    `title: ${draft.title || "(empty)"}`,
  ];
  if (draft.signals.travelLike) lines.push("context: travel or appointment");
  if (draft.dueDate) {
    const date = draft.dueDate.slice(0, 10);
    const time = draft.isAllDay ? "all-day" : (draft.inferredDue?.time || draft.dueDate.slice(11, 16));
    const day = draft.inferredDue?.day ? `${draft.inferredDue.day} ` : "";
    lines.push(`due: ${day}${date} ${time} (${draft.timeZone})`);
  }
  if (draft.travelEstimate) {
    lines.push(`travel estimate: ${draft.travelEstimate.reserveMinutes} minutes`);
    lines.push("estimate basis: local default + buffer; weather/traffic not checked");
  }
  const details = String(draft.notes || "").split(" | ").map((detail) => detail.trim()).filter(Boolean);
  if (details.length) {
    lines.push("captured details:");
    for (const detail of details) lines.push(`- ${detail}`);
  }
  if (draft.projectRoute) {
    const label = draft.projectRoute.projectName
      ? `${draft.projectRoute.projectName} (${draft.projectRoute.projectId})`
      : draft.projectRoute.projectId;
    lines.push(`project route: ${draft.projectRoute.keyword} -> ${label}`);
  }
  if (draft.canCreateNow) {
    lines.push("Ready to create. Send /confirm to write it to TickTick, or /cancel.");
    return lines.join("\n");
  }

  lines.push("", "Before I create it, I need:");
  for (const question of draft.questions) lines.push(`- ${question}`);
  lines.push("", "Reply with details, or send /cancel.");
  return lines.join("\n");
}
