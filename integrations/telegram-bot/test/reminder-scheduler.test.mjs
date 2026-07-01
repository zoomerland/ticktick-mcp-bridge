import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { SessionStore } from "../src/session-store.mjs";
import { runReminderOnce } from "../src/reminder-scheduler.mjs";

function config(overrides = {}) {
  return loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: "10",
    TELEGRAM_REMINDERS_ENABLED: "true",
    TELEGRAM_REMINDER_CHAT_ID: "10",
    TELEGRAM_REMINDER_LEAD_MINUTES: "30",
    ...overrides,
  });
}

test("runReminderOnce sends upcoming reminder and deduplicates it", async () => {
  const session = new SessionStore();
  const sent = [];
  const now = new Date("2026-06-24T10:00:00Z");
  const bridge = {
    async callTool(name) {
      assert.equal(name, "ticktick_today");
      return {
        tasks: [
          { id: "soon", title: "Soon task", dueDate: "2026-06-24T10:20:00+0000", dueBucket: "today" },
        ],
      };
    },
  };
  const telegram = {
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
    },
  };

  const first = await runReminderOnce({ bridge, config: config(), telegram, session, now });
  const second = await runReminderOnce({ bridge, config: config(), telegram, session, now });

  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(second.skipped, "duplicate");
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Soon task/);
});

test("runReminderOnce sends only unsent reminder items", async () => {
  const session = new SessionStore();
  const sent = [];
  const now = new Date("2026-06-24T10:00:00Z");
  const alreadySentDue = Date.parse("2026-06-24T10:10:00+0000");
  session.getReminderState().sent[`already@${alreadySentDue}`] = now.toISOString();
  const bridge = {
    async callTool(name) {
      assert.equal(name, "ticktick_today");
      return {
        tasks: [
          { id: "already", title: "Already sent", dueDate: "2026-06-24T10:10:00+0000", dueBucket: "today" },
          { id: "new", title: "New reminder", dueDate: "2026-06-24T10:20:00+0000", dueBucket: "today" },
        ],
      };
    },
  };
  const telegram = {
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
    },
  };

  const result = await runReminderOnce({ bridge, config: config(), telegram, session, now });

  assert.equal(result.sent, true);
  assert.equal(result.count, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /New reminder/);
  assert.doesNotMatch(sent[0].text, /Already sent/);
});

test("runReminderOnce stays quiet when disabled", async () => {
  const sent = [];
  const result = await runReminderOnce({
    bridge: { callTool: async () => { throw new Error("should not query bridge"); } },
    config: config({ TELEGRAM_REMINDERS_ENABLED: "false" }),
    telegram: { sendMessage: async (...args) => sent.push(args) },
    session: new SessionStore(),
  });

  assert.equal(result.sent, false);
  assert.equal(result.skipped, "disabled");
  assert.equal(sent.length, 0);
});
