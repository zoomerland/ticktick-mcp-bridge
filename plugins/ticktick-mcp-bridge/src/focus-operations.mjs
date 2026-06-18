import { ticktickRequest } from "./ticktick-api.mjs";

export const focusTypeSchema = {
  type: "number",
  enum: [0, 1],
  description: "TickTick focus type: Pomodoro is 0, Timing is 1.",
};

export function normalizeFocusType(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(value);
}

export async function getFocus(args = {}) {
  return ticktickRequest("GET", `/focus/${encodeURIComponent(args.focusId)}`, undefined, {
    type: normalizeFocusType(args.type),
  });
}

export async function listFocuses(args = {}) {
  return ticktickRequest("GET", "/focus", undefined, {
    from: args.from,
    to: args.to,
    type: normalizeFocusType(args.type),
  });
}

export async function deleteFocus(args = {}) {
  return ticktickRequest("DELETE", `/focus/${encodeURIComponent(args.focusId)}`, undefined, {
    type: normalizeFocusType(args.type),
  });
}

export async function analyzeFocus(args = {}) {
  const types = args.type === undefined || args.type === null ? [0, 1] : [normalizeFocusType(args.type)];
  const byType = {};
  const sessions = [];
  for (const type of types) {
    const items = await listFocuses({ ...args, type });
    const typeSessions = Array.isArray(items) ? items : [];
    const totalDurationSeconds = typeSessions.reduce((sum, item) => sum + Number(item.duration || 0), 0);
    byType[type === 0 ? "pomodoro" : "timing"] = {
      type,
      count: typeSessions.length,
      totalDurationSeconds,
      totalDurationMinutes: Math.round(totalDurationSeconds / 60),
    };
    sessions.push(...typeSessions);
  }
  const totalDurationSeconds = sessions.reduce((sum, item) => sum + Number(item.duration || 0), 0);
  return {
    from: args.from,
    to: args.to,
    totalCount: sessions.length,
    totalDurationSeconds,
    totalDurationMinutes: Math.round(totalDurationSeconds / 60),
    byType,
    sessions: args.includeSessions === false ? undefined : sessions,
  };
}
