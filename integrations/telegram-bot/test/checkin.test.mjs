import test from "node:test";
import assert from "node:assert/strict";
import { routeText } from "../src/command-router.mjs";
import { loadConfig } from "../src/config.mjs";
import { buildCheckinPrompt, resolveCheckinReply } from "../src/secretary/checkin.mjs";
import { SessionStore } from "../src/session-store.mjs";

function config(overrides = {}) {
  return loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: "10",
    TELEGRAM_CONFIRM_WRITES: "true",
    TELEGRAM_MAX_RESULTS: "3",
    ...overrides,
  });
}

function todayData() {
  return {
    tasks: [
      { id: "main", projectId: "project-1", title: "Main focus", dueBucket: "today", priority: 5 },
      { id: "admin", projectId: "project-1", title: "Admin task", dueBucket: "today", priority: 1 },
      { id: "late", projectId: "project-1", title: "Late task", dueBucket: "overdue", priority: 3 },
    ],
  };
}

test("check-in prompt summarizes the day and asks a concrete question", () => {
  const result = buildCheckinPrompt({
    now: new Date("2026-06-24T10:00:00+03:00"),
    todayData: todayData(),
    inboxData: [{ title: "Clarify route" }],
  }, config());

  assert.equal(result.kind, "checkin");
  assert.equal(result.status, "overdue");
  assert.equal(result.pending.type, "checkin");
  assert.match(result.text, /Day check-in/);
  assert.match(result.text, /status: overdue/);
  assert.match(result.text, /Question:/);
  assert.match(result.text, /Useful replies:/);
  assert.match(result.text, /Main focus/);
});

test("check-in reply classifier maps safe day-control answers", () => {
  assert.deepEqual(resolveCheckinReply("I am on track"), { action: "ack" });
  assert.deepEqual(resolveCheckinReply("I am tired"), { action: "postpone_rest" });
  assert.deepEqual(resolveCheckinReply("leave only the main task"), { action: "postpone_rest" });
  assert.deepEqual(resolveCheckinReply("cancel today"), { action: "postpone_all" });
  assert.deepEqual(resolveCheckinReply("I am late"), { action: "repair" });
});

test("/checkin performs read-only bridge calls and stores pending check-in", async () => {
  const calls = [];
  const session = new SessionStore();
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_today") return todayData();
      if (name === "ticktick_inbox") return [];
      throw new Error(`unexpected tool ${name}`);
    },
  };

  const result = await routeText("/checkin", { bridge, config: config(), session });

  assert.equal(result.kind, "bridge");
  assert.equal(result.tool, "secretary_checkin");
  assert.match(result.text, /Day check-in/);
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today", "ticktick_inbox"]);
  assert.equal(session.getPendingCheckin("local").type, "checkin");
});

test("tired reply after check-in creates a pending protected-focus repair without writing", async () => {
  const calls = [];
  const session = new SessionStore();
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_today") return todayData();
      if (name === "ticktick_inbox") return [];
      if (name === "ticktick_update_task") return { id: args.taskId, updated: true };
      throw new Error(`unexpected tool ${name}`);
    },
  };
  const cfg = config();

  await routeText("/checkin", { bridge, config: cfg, session });
  const repair = await routeText("I am tired", { bridge, config: cfg, session });

  assert.equal(repair.kind, "postpone_draft");
  assert.match(repair.text, /mode: rest_today/);
  assert.match(repair.text, /Send \/confirm/);
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today", "ticktick_inbox", "ticktick_today"]);
  assert.equal(session.getPendingAction("local").type, "postpone_tasks");

  const confirmed = await routeText("/confirm", { bridge, config: cfg, session });
  assert.equal(confirmed.kind, "postponed_tasks");
  assert.deepEqual(calls.map((call) => call.name), [
    "ticktick_today",
    "ticktick_inbox",
    "ticktick_today",
    "ticktick_update_task",
  ]);
});

test("on-track reply after check-in clears pending state without bridge writes", async () => {
  const calls = [];
  const session = new SessionStore();
  const bridge = {
    async callTool(name) {
      calls.push(name);
      if (name === "ticktick_today") return todayData();
      if (name === "ticktick_inbox") return [];
      throw new Error(`unexpected tool ${name}`);
    },
  };

  await routeText("/checkin", { bridge, config: config(), session });
  const result = await routeText("I am on track", { bridge, config: config(), session });

  assert.equal(result.kind, "checkin_ack");
  assert.match(result.text, /plan unchanged/);
  assert.equal(session.getPendingCheckin("local"), null);
  assert.deepEqual(calls, ["ticktick_today", "ticktick_inbox"]);
});
