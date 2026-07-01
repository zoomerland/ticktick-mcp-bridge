import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import {
  buildPostponeAllTodayAction,
  buildPostponeRestTodayAction,
  buildPostponeTodayAction,
  buildScheduleRepair,
  formatPostponeTodayAction,
  isPostponeAllTomorrowIntent,
  isPostponeRestTomorrowIntent,
  isPostponeTomorrowIntent,
  isScheduleRepairIntent,
  tomorrowAllDayDueDate,
} from "../src/secretary/repair.mjs";

function config() {
  return loadConfig({ TELEGRAM_DRY_RUN: "true", TELEGRAM_ALLOWED_USER_IDS: "10" });
}

test("detects Russian schedule repair intent", () => {
  assert.equal(isScheduleRepairIntent("я не успеваю это сделать"), true);
  assert.equal(isScheduleRepairIntent("давай перенесем планы"), true);
  assert.equal(isScheduleRepairIntent("купить хлеб"), false);
});

test("detects natural tomorrow postpone intent", () => {
  assert.equal(isPostponeTomorrowIntent("move today's lower priority tasks tomorrow"), true);
  assert.equal(isPostponeTomorrowIntent("postpone everything to next day"), true);
  assert.equal(isPostponeTomorrowIntent("cancel today"), false);
});

test("detects natural all-today postpone intent", () => {
  assert.equal(isPostponeAllTomorrowIntent("cancel today's plans"), true);
  assert.equal(isPostponeAllTomorrowIntent("move everything tomorrow"), true);
  assert.equal(isPostponeAllTomorrowIntent("перенеси всё на завтра"), true);
  assert.equal(isPostponeAllTomorrowIntent("move today's lower priority tasks tomorrow"), false);
});

test("detects natural rest-today postpone intent", () => {
  assert.equal(isPostponeRestTomorrowIntent("keep only the highest-priority item and reschedule the rest"), true);
  assert.equal(isPostponeRestTomorrowIntent("protect the main task"), true);
  assert.equal(isPostponeRestTomorrowIntent("оставь главное"), true);
  assert.equal(isPostponeRestTomorrowIntent("перенеси остальное на завтра"), true);
  assert.equal(isPostponeRestTomorrowIntent("move today's lower priority tasks tomorrow"), false);
});

test("buildScheduleRepair proposes safe options without writing", () => {
  const text = buildScheduleRepair({
    userText: "я не успеваю",
    todayData: {
      tasks: [
        { title: "High overdue", dueBucket: "overdue", priority: 5 },
        { title: "Low today", dueBucket: "today", priority: 1 },
      ],
    },
  }, config());

  assert.match(text, /Schedule repair draft/);
  assert.match(text, /Before changing TickTick/);
  assert.match(text, /High overdue/);
  assert.match(text, /No changes have been written/);
});

test("buildPostponeTodayAction moves only non-high-priority today tasks", () => {
  const action = buildPostponeTodayAction({
    now: new Date("2026-06-24T12:00:00Z"),
    destination: "tomorrow",
    config: config(),
    todayData: {
      tasks: [
        { id: "low", title: "Low today", dueBucket: "today", priority: 1 },
        { id: "high", title: "High today", dueBucket: "today", priority: 5 },
        { id: "late", title: "Late", dueBucket: "overdue", priority: 1 },
      ],
    },
  });

  assert.equal(action.valid, true);
  assert.equal(action.updates.length, 1);
  assert.equal(action.updates[0].taskId, "low");
  assert.equal(action.updates[0].dueDate, "2026-06-25T00:00:00+0000");
});

test("buildPostponeAllTodayAction moves all today tasks including high priority", () => {
  const action = buildPostponeAllTodayAction({
    now: new Date("2026-06-24T12:00:00Z"),
    destination: "tomorrow",
    config: config(),
    todayData: {
      tasks: [
        { id: "low", title: "Low today", dueBucket: "today", priority: 1 },
        { id: "high", title: "High today", dueBucket: "today", priority: 5 },
        { id: "late", title: "Late", dueBucket: "overdue", priority: 1 },
      ],
    },
  });

  assert.equal(action.valid, true);
  assert.equal(action.mode, "all_today");
  assert.deepEqual(action.updates.map((update) => update.taskId), ["low", "high"]);
  assert.equal(action.updates[0].dueDate, "2026-06-25T00:00:00+0000");
});

test("buildPostponeRestTodayAction keeps tied top-priority today tasks and moves the rest", () => {
  const action = buildPostponeRestTodayAction({
    now: new Date("2026-06-24T12:00:00Z"),
    destination: "tomorrow",
    config: config(),
    todayData: {
      tasks: [
        { id: "main-a", title: "Main A", dueBucket: "today", priority: 5 },
        { id: "main-b", title: "Main B", dueBucket: "today", priority: 5 },
        { id: "rest", title: "Rest today", dueBucket: "today", priority: 3 },
        { title: "No id today", dueBucket: "today", priority: 1 },
        { id: "late", title: "Late", dueBucket: "overdue", priority: 0 },
      ],
    },
  });

  assert.equal(action.valid, true);
  assert.equal(action.mode, "rest_today");
  assert.deepEqual(action.kept.map((task) => task.taskId), ["main-a", "main-b"]);
  assert.deepEqual(action.updates.map((update) => update.taskId), ["rest"]);
  assert.equal(action.skipped.length, 1);
  assert.equal(action.updates[0].dueDate, "2026-06-25T00:00:00+0000");

  const text = formatPostponeTodayAction(action);
  assert.match(text, /kept: 2/);
  assert.match(text, /Main A/);
  assert.match(text, /Main B/);
  assert.match(text, /Rest today/);
  assert.doesNotMatch(text, /Late/);
});

test("tomorrowAllDayDueDate formats TickTick-style all-day timestamp", () => {
  assert.equal(tomorrowAllDayDueDate(new Date("2026-12-31T12:00:00Z")), "2027-01-01T00:00:00+0000");
});
