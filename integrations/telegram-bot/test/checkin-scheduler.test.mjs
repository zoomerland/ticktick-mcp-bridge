import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { runCheckinOnce } from "../src/checkin-scheduler.mjs";
import { SessionStore } from "../src/session-store.mjs";

function config(overrides = {}) {
  return loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: "10",
    TELEGRAM_CHECKIN_ENABLED: "true",
    TELEGRAM_CHECKIN_CHAT_ID: "10",
    TELEGRAM_CHECKIN_HOURS: "9-21",
    ...overrides,
  });
}

function bridge() {
  return {
    async callTool(name) {
      if (name === "ticktick_today") {
        return {
          tasks: [
            { id: "main", projectId: "project-1", title: "Main focus", dueBucket: "today", priority: 5 },
            { id: "late", projectId: "project-1", title: "Late task", dueBucket: "overdue", priority: 3 },
          ],
        };
      }
      if (name === "ticktick_inbox") return [];
      throw new Error(`unexpected tool ${name}`);
    },
  };
}

test("runCheckinOnce sends one check-in, stores pending state, and deduplicates the next one", async () => {
  const sent = [];
  const session = new SessionStore();
  const telegram = { sendMessage: async (chatId, text) => sent.push({ chatId, text }) };
  const now = new Date("2026-06-24T12:00:00+03:00");

  const first = await runCheckinOnce({ bridge: bridge(), config: config(), telegram, session, now });
  const second = await runCheckinOnce({ bridge: bridge(), config: config(), telegram, session, now });

  assert.equal(first.sent, true);
  assert.equal(first.status, "overdue");
  assert.equal(second.sent, false);
  assert.equal(second.skipped, "duplicate");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, "10");
  assert.match(sent[0].text, /Day check-in/);
  assert.equal(session.getPendingCheckin("10").type, "checkin");
  assert.equal(Boolean(session.getCheckinState().lastCheckinSignature), true);
});

test("runCheckinOnce does not send when disabled", async () => {
  const sent = [];
  const result = await runCheckinOnce({
    bridge: bridge(),
    config: config({ TELEGRAM_CHECKIN_ENABLED: "false" }),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    session: new SessionStore(),
    now: new Date("2026-06-24T12:00:00+03:00"),
  });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, "disabled");
  assert.equal(sent.length, 0);
});

test("runCheckinOnce requires a target chat id", async () => {
  const sent = [];
  const result = await runCheckinOnce({
    bridge: bridge(),
    config: config({ TELEGRAM_CHECKIN_CHAT_ID: "", TELEGRAM_PROACTIVE_CHAT_ID: "" }),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    session: new SessionStore(),
    now: new Date("2026-06-24T12:00:00+03:00"),
  });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, "missing_chat_id");
  assert.equal(sent.length, 0);
});

test("runCheckinOnce respects quiet hours", async () => {
  const sent = [];
  const result = await runCheckinOnce({
    bridge: bridge(),
    config: config({ TELEGRAM_QUIET_HOURS: "23-8" }),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    session: new SessionStore(),
    now: new Date("2026-06-24T02:00:00+03:00"),
  });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, "quiet_hours");
  assert.equal(result.inQuietHours, true);
  assert.equal(sent.length, 0);
});

test("runCheckinOnce respects check-in hours", async () => {
  const sent = [];
  const result = await runCheckinOnce({
    bridge: bridge(),
    config: config({ TELEGRAM_CHECKIN_HOURS: "9-21" }),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    session: new SessionStore(),
    now: new Date("2026-06-24T08:00:00+03:00"),
  });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, "outside_checkin_hours");
  assert.equal(result.inCheckinHours, false);
  assert.equal(sent.length, 0);
});
