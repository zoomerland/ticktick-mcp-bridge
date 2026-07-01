import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { runProactiveOnce } from "../src/proactive-scheduler.mjs";

function config(overrides = {}) {
  return loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: "10",
    TELEGRAM_PROACTIVE_ENABLED: "true",
    TELEGRAM_PROACTIVE_CHAT_ID: "10",
    ...overrides,
  });
}

test("runProactiveOnce sends one useful nudge and deduplicates the next one", async () => {
  const sent = [];
  const state = {};
  const bridge = {
    async callTool(name) {
      if (name === "ticktick_today") {
        return { tasks: [{ title: "Late bill", dueBucket: "overdue", priority: 5 }] };
      }
      if (name === "ticktick_inbox") return [];
      throw new Error(`unexpected tool ${name}`);
    },
  };
  const telegram = { sendMessage: async (chatId, text) => sent.push({ chatId, text }) };

  const first = await runProactiveOnce({
    bridge,
    config: config(),
    telegram,
    state,
    now: new Date("2026-06-24T14:00:00+03:00"),
  });
  const second = await runProactiveOnce({
    bridge,
    config: config(),
    telegram,
    state,
    now: new Date("2026-06-24T14:10:00+03:00"),
  });

  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(second.skipped, "duplicate");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, "10");
});

test("runProactiveOnce sends again when task content changes with same counts", async () => {
  const sent = [];
  const state = {};
  const tasksByRun = [
    [{ title: "Late bill", dueBucket: "overdue", priority: 5 }],
    [{ title: "Late tax form", dueBucket: "overdue", priority: 5 }],
  ];
  const bridge = {
    async callTool(name) {
      if (name === "ticktick_today") return { tasks: tasksByRun[Math.min(sent.length, 1)] };
      if (name === "ticktick_inbox") return [];
      throw new Error(`unexpected tool ${name}`);
    },
  };
  const telegram = { sendMessage: async (chatId, text) => sent.push({ chatId, text }) };

  const first = await runProactiveOnce({
    bridge,
    config: config(),
    telegram,
    state,
    now: new Date("2026-06-24T14:00:00+03:00"),
  });
  const second = await runProactiveOnce({
    bridge,
    config: config(),
    telegram,
    state,
    now: new Date("2026-06-24T14:10:00+03:00"),
  });

  assert.equal(first.sent, true);
  assert.equal(second.sent, true);
  assert.equal(sent.length, 2);
  assert.doesNotMatch(state.lastProactiveSignature, /Late bill|Late tax form/);
});

test("runProactiveOnce does not send when disabled", async () => {
  const sent = [];
  const bridge = {
    async callTool(name) {
      if (name === "ticktick_today") return { tasks: [{ title: "Late bill", dueBucket: "overdue" }] };
      if (name === "ticktick_inbox") return [];
      return {};
    },
  };

  const result = await runProactiveOnce({
    bridge,
    config: config({ TELEGRAM_PROACTIVE_ENABLED: "false" }),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    now: new Date("2026-06-24T14:00:00+03:00"),
  });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, "disabled");
  assert.equal(sent.length, 0);
});

test("runProactiveOnce skips outside check-in hours", async () => {
  const sent = [];
  const bridge = {
    async callTool(name) {
      if (name === "ticktick_today") return { tasks: [{ title: "Late bill", dueBucket: "overdue" }] };
      if (name === "ticktick_inbox") return [];
      throw new Error(`unexpected tool ${name}`);
    },
  };

  const result = await runProactiveOnce({
    bridge,
    config: config({ TELEGRAM_CHECKIN_HOURS: "9-21" }),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    now: new Date("2026-06-24T08:00:00+03:00"),
  });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, "no_notification_needed");
  assert.equal(result.reasons.inCheckinHours, false);
  assert.equal(sent.length, 0);
});
