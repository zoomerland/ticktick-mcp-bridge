import assert from "node:assert/strict";
import { taskDueBucket, ymdInTimeZone } from "../src/ticktick-api.mjs";
import { normalizeTask, sortTasks } from "../src/ticktick-data.mjs";

const afterMoscowMidnight = new Date("2026-07-01T22:30:00Z");

assert.equal(ymdInTimeZone(afterMoscowMidnight, "UTC"), "2026-07-01");
assert.equal(ymdInTimeZone(afterMoscowMidnight, "Europe/Moscow"), "2026-07-02");

assert.equal(
  taskDueBucket(
    { dueDate: "2026-07-01T12:00:00+0300" },
    afterMoscowMidnight,
    { timeZone: "UTC" },
  ),
  "today",
);

assert.equal(
  taskDueBucket(
    { dueDate: "2026-07-01T12:00:00+0300" },
    afterMoscowMidnight,
    { timeZone: "Europe/Moscow" },
  ),
  "overdue",
);

assert.equal(
  taskDueBucket(
    { startDate: "2026-07-01T12:00:00+0300" },
    afterMoscowMidnight,
    { timeZone: "Europe/Moscow" },
  ),
  "overdue",
);

const tasks = [
  normalizeTask({ id: "later", title: "Later", startDate: "2026-07-03T12:00:00+0300" }),
  normalizeTask({ id: "first", title: "First", startDate: "2026-07-01T12:00:00+0300" }),
];

assert.deepEqual(sortTasks(tasks).map((task) => task.id), ["first", "later"]);

console.log("Date bucket regression tests passed.");
