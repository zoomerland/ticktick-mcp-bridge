import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { analyzeScheduleShape, buildProactiveReview } from "../src/secretary/proactive.mjs";

function config() {
  return loadConfig({ TELEGRAM_DRY_RUN: "true", TELEGRAM_ALLOWED_USER_IDS: "10" });
}

test("proactive review suggests action for overdue tasks", () => {
  const review = buildProactiveReview({
    now: new Date("2026-06-24T14:00:00+03:00"),
    todayData: {
      tasks: [
        { title: "Late payment", dueBucket: "overdue", priority: 5, projectName: "Payments" },
      ],
    },
    inboxData: [],
  }, config());

  assert.equal(review.shouldNotify, true);
  assert.equal(review.reasons.overdueCount, 1);
  assert.equal(review.reasons.inCheckinHours, true);
  assert.match(review.text, /rescheduling/);
  assert.match(review.text, /Late payment/);
});

test("proactive review respects quiet hours", () => {
  const review = buildProactiveReview({
    now: new Date("2026-06-24T02:00:00+03:00"),
    todayData: { tasks: [] },
    inboxData: [],
  }, config());

  assert.equal(review.shouldNotify, false);
  assert.equal(review.reasons.inQuietHours, true);
  assert.match(review.text, /Quiet-hours/);
});

test("proactive review respects check-in hours", () => {
  const review = buildProactiveReview({
    now: new Date("2026-06-24T08:00:00+03:00"),
    todayData: {
      tasks: [
        { title: "Late payment", dueBucket: "overdue", priority: 5, projectName: "Payments" },
      ],
    },
    inboxData: [],
  }, config());

  assert.equal(review.shouldNotify, false);
  assert.equal(review.reasons.inCheckinHours, false);
  assert.match(review.text, /Check-in window/);
});

test("proactive review detects a large open window before the next timed task", () => {
  const review = buildProactiveReview({
    now: new Date("2026-06-24T10:00:00+03:00"),
    todayData: {
      tasks: [
        { title: "Afternoon appointment", dueBucket: "today", dueDate: "2026-06-24T12:00:00+0300", priority: 3 },
      ],
    },
    inboxData: [],
  }, config());

  assert.equal(review.shouldNotify, true);
  assert.equal(review.reasons.nextGapMinutes, 120);
  assert.equal(review.reasons.hasLargeOpenWindow, true);
  assert.match(review.text, /120m open window/);
  assert.match(review.text, /Next timed item/);
  assert.match(review.text, /Afternoon appointment/);
});

test("proactive review detects near-term overload", () => {
  const review = buildProactiveReview({
    now: new Date("2026-06-24T10:00:00+03:00"),
    todayData: {
      tasks: [
        { title: "Call one", dueBucket: "today", dueDate: "2026-06-24T10:20:00+0300", priority: 3 },
        { title: "Call two", dueBucket: "today", dueDate: "2026-06-24T10:50:00+0300", priority: 3 },
        { title: "Call three", dueBucket: "today", dueDate: "2026-06-24T11:30:00+0300", priority: 3 },
      ],
    },
    inboxData: [],
  }, config());

  assert.equal(review.shouldNotify, true);
  assert.equal(review.reasons.overloaded, true);
  assert.equal(review.reasons.nearTimedCount, 3);
  assert.match(review.text, /looks dense/);
  assert.match(review.text, /Near-term density: 3/);
});

test("proactive review does not duplicate the same task as top and next timed item", () => {
  const review = buildProactiveReview({
    now: new Date("2026-06-24T10:00:00+03:00"),
    todayData: {
      tasks: [
        { id: "focus-1", title: "Focused block", dueBucket: "today", dueDate: "2026-06-24T10:30:00+0300", priority: 5 },
      ],
    },
    inboxData: [],
  }, config());

  assert.match(review.text, /Top item to mention/);
  assert.doesNotMatch(review.text, /Next timed item/);
});

test("schedule shape separates timed and untimed today items", () => {
  const shape = analyzeScheduleShape([
    { title: "Timed", dueBucket: "today", dueDate: "2026-06-24T12:00:00+0300" },
    { title: "Untimed", dueBucket: "today" },
    { title: "Overdue", dueBucket: "overdue", dueDate: "2026-06-23T12:00:00+0300" },
  ], { now: new Date("2026-06-24T10:00:00+03:00") });

  assert.equal(shape.timedTodayCount, 1);
  assert.equal(shape.untimedTodayCount, 1);
  assert.equal(shape.nextGapMinutes, 120);
  assert.equal(shape.nextTask.title, "Timed");
});
