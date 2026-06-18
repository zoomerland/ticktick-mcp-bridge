import { prune, ticktickRequest } from "./ticktick-api.mjs";

export const habitFields = {
  name: { type: "string", description: "Habit name. Maximum length is 1000 characters." },
  iconRes: { type: "string", description: "TickTick habit icon resource, for example habit_reading." },
  color: { type: "string", description: "Hex color, for example #4D8CF5." },
  sortOrder: { type: "number" },
  status: { type: "number" },
  encouragement: { type: "string" },
  type: { type: "string", description: "Habit type, for example Boolean." },
  goal: { type: "number" },
  step: { type: "number" },
  unit: { type: "string", description: "Habit unit, for example Count." },
  repeatRule: { type: "string", description: "RRULE, for example RRULE:FREQ=DAILY;INTERVAL=1." },
  reminders: { type: "array", items: { type: "string" } },
  recordEnable: { type: "boolean" },
  sectionId: { type: "string" },
  targetDays: { type: "number" },
  targetStartDate: { type: "number", description: "Date stamp in YYYYMMDD format, for example 20240101." },
  exDates: { type: "array", items: { type: "string" } },
  style: { type: "number" },
};

export const habitCheckinFields = {
  stamp: { type: "number", description: "Date stamp in YYYYMMDD format, for example 20260407." },
  time: { type: "string", description: "Check-in time, for example 2026-04-07T08:00:00+0000." },
  value: { type: "number", default: 1 },
  goal: { type: "number", default: 1 },
  status: { type: "number" },
};

export async function listHabits() {
  return ticktickRequest("GET", "/habit");
}

export async function getHabit(args = {}) {
  return ticktickRequest("GET", `/habit/${encodeURIComponent(args.habitId)}`);
}

export async function createHabit(args = {}) {
  return ticktickRequest("POST", "/habit", prune(args));
}

export async function updateHabit(args = {}) {
  const { habitId, ...payload } = args;
  return ticktickRequest("POST", `/habit/${encodeURIComponent(habitId)}`, prune(payload));
}

export async function checkInHabit(args = {}) {
  const { habitId, ...payload } = args;
  return ticktickRequest("POST", `/habit/${encodeURIComponent(habitId)}/checkin`, prune(payload));
}

export function normalizeHabitIds(value) {
  if (Array.isArray(value)) return value.join(",");
  return String(value || "");
}

export async function listHabitCheckins(args = {}) {
  return ticktickRequest("GET", "/habit/checkins", undefined, {
    habitIds: normalizeHabitIds(args.habitIds),
    from: args.from,
    to: args.to,
  });
}
