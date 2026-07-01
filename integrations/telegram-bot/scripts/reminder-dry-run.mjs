import { loadConfig } from "../src/config.mjs";
import { SessionStore } from "../src/session-store.mjs";
import { runReminderOnce } from "../src/reminder-scheduler.mjs";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function ticktickDateMinutesFrom(base, minutes) {
  const date = new Date(base.getTime() + minutes * 60 * 1000);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:00+0000`;
}

const now = new Date("2026-06-24T12:00:00Z");
const config = loadConfig({
  TELEGRAM_DRY_RUN: "true",
  TELEGRAM_ALLOWED_USER_IDS: "1001",
  TELEGRAM_REMINDERS_ENABLED: "true",
  TELEGRAM_REMINDER_CHAT_ID: "1001",
  TELEGRAM_REMINDER_LEAD_MINUTES: "30",
});

const session = new SessionStore();
const sent = [];

const bridge = {
  async callTool(name) {
    if (name === "ticktick_today") {
      return {
        tasks: [
          { id: "soon-1", title: "Leave for appointment", dueBucket: "today", dueDate: ticktickDateMinutesFrom(now, 20), priority: 5 },
          { id: "later-1", title: "Later task", dueBucket: "today", dueDate: ticktickDateMinutesFrom(now, 120), priority: 1 },
        ],
      };
    }
    return { tasks: [] };
  },
};

const telegram = {
  async sendMessage(chatId, text) {
    sent.push({ chatId, text });
  },
};

const first = await runReminderOnce({ bridge, config, telegram, session, now });
const second = await runReminderOnce({ bridge, config, telegram, session, now });

console.log(sent[0]?.text || "No reminder sent.");
console.log(JSON.stringify({
  first: { sent: first.sent, count: first.count, skipped: first.skipped },
  second: { sent: second.sent, count: second.count, skipped: second.skipped },
  sentCount: sent.length,
}, null, 2));
