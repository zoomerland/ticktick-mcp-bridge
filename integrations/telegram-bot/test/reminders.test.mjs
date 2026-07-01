import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { buildUpcomingReminders } from "../src/secretary/reminders.mjs";

function config() {
  return loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_REMINDER_LEAD_MINUTES: "30",
  });
}

test("buildUpcomingReminders finds tasks inside lead window", () => {
  const reminder = buildUpcomingReminders({
    now: new Date("2026-06-24T10:00:00Z"),
    todayData: {
      tasks: [
        { title: "Soon", dueDate: "2026-06-24T10:20:00+0000", dueBucket: "today" },
        { title: "Later", dueDate: "2026-06-24T12:00:00+0000", dueBucket: "today" },
      ],
    },
  }, config());

  assert.equal(reminder.shouldNotify, true);
  assert.equal(reminder.count, 1);
  assert.match(reminder.text, /Soon/);
  assert.doesNotMatch(reminder.text, /Later/);
});

test("buildUpcomingReminders respects profile lead override", () => {
  const reminder = buildUpcomingReminders({
    now: new Date("2026-06-24T10:00:00Z"),
    todayData: {
      tasks: [
        { title: "In an hour", dueDate: "2026-06-24T11:00:00+0000", dueBucket: "today" },
      ],
    },
  }, config(), { reminderLeadMinutes: 90 });

  assert.equal(reminder.shouldNotify, true);
  assert.match(reminder.text, /90m/);
});
