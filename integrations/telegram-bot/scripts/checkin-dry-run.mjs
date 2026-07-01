import { loadConfig } from "../src/config.mjs";
import { SessionStore } from "../src/session-store.mjs";
import { runCheckinOnce } from "../src/checkin-scheduler.mjs";

const config = loadConfig({
  TELEGRAM_DRY_RUN: "true",
  TELEGRAM_ALLOWED_USER_IDS: "1001",
  TELEGRAM_CHECKIN_ENABLED: "true",
  TELEGRAM_CHECKIN_CHAT_ID: "1001",
  TELEGRAM_CHECKIN_HOURS: "9-21",
  TELEGRAM_MAX_RESULTS: "3",
});

const session = new SessionStore();
const sent = [];

const bridge = {
  async callTool(name) {
    if (name === "ticktick_today") {
      return {
        tasks: [
          { id: "main", projectId: "project-work", title: "Focused block", projectName: "Work", dueBucket: "today", priority: 5 },
          { id: "admin", projectId: "project-work", title: "Admin cleanup", projectName: "Work", dueBucket: "today", priority: 1 },
          { id: "late", projectId: "project-personal", title: "Late errand", projectName: "Personal", dueBucket: "overdue", priority: 3 },
        ],
      };
    }
    if (name === "ticktick_inbox") {
      return [{ title: "Clarify travel time", projectName: "Inbox" }];
    }
    throw new Error(`unexpected tool ${name}`);
  },
};

const telegram = {
  async sendMessage(chatId, text) {
    sent.push({ chatId, text });
  },
};

const now = new Date("2026-06-24T12:00:00+03:00");
const first = await runCheckinOnce({ bridge, config, telegram, session, now });
const second = await runCheckinOnce({ bridge, config, telegram, session, now });

console.log(sent[0]?.text || "No check-in sent.");
console.log(JSON.stringify({
  first: { sent: first.sent, status: first.status, skipped: first.skipped },
  second: { sent: second.sent, status: second.status, skipped: second.skipped },
  sentCount: sent.length,
  hasPendingCheckin: Boolean(session.getPendingCheckin("1001")),
}, null, 2));
