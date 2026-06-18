import assert from "node:assert/strict";
import { normalizeFocusType } from "../src/focus-operations.mjs";
import { normalizeHabitIds } from "../src/habit-operations.mjs";
import {
  completedTaskPayload,
  officialMoveTaskPayload,
  officialTaskFilterPayload,
} from "../src/task-operations.mjs";

assert.deepEqual(officialMoveTaskPayload({
  taskId: "task-1",
  fromProjectId: "project-a",
  toProjectId: "project-b",
}), {
  taskId: "task-1",
  fromProjectId: "project-a",
  toProjectId: "project-b",
});

assert.deepEqual(officialMoveTaskPayload({
  taskId: "task-1",
  sourceProjectId: "project-a",
  targetProjectId: "project-b",
}), {
  taskId: "task-1",
  fromProjectId: "project-a",
  toProjectId: "project-b",
});

assert.deepEqual(officialTaskFilterPayload({
  projectIds: ["project-a"],
  startDate: "2026-03-01T00:00:00.000+0000",
  endDate: "2026-03-06T00:00:00.000+0000",
  priority: [0, 5],
  tag: ["urgent"],
  status: [0],
  limit: 10,
}), {
  projectIds: ["project-a"],
  startDate: "2026-03-01T00:00:00.000+0000",
  endDate: "2026-03-06T00:00:00.000+0000",
  priority: [0, 5],
  tag: ["urgent"],
  status: [0],
});

assert.deepEqual(completedTaskPayload({
  projectIds: ["project-a"],
  startDate: "2026-03-01T00:00:00.000+0000",
  endDate: "2026-03-06T00:00:00.000+0000",
  limit: 5,
}), {
  projectIds: ["project-a"],
  startDate: "2026-03-01T00:00:00.000+0000",
  endDate: "2026-03-06T00:00:00.000+0000",
});

assert.equal(normalizeHabitIds(["habit-1", "habit-2"]), "habit-1,habit-2");
assert.equal(normalizeHabitIds("habit-1,habit-2"), "habit-1,habit-2");
assert.equal(normalizeFocusType(undefined), 0);
assert.equal(normalizeFocusType("1"), 1);

console.log("Official OpenAPI tool regression tests passed.");
