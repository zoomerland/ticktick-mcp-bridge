import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTaskDraft,
  buildCreateTaskArgs,
  formatTaskDraft,
  refineTaskDraft,
} from "../src/secretary/capture.mjs";
import { loadConfig } from "../src/config.mjs";

function config(overrides = {}) {
  return loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: "10",
    TELEGRAM_CONFIRM_WRITES: "true",
    TELEGRAM_DEFAULT_PROJECT_ID: "project-1",
    ...overrides,
  });
}

test("capture infers Russian tomorrow as an all-day create due date", () => {
  const cfg = config();
  const draft = analyzeTaskDraft(
    "позвонить доктору завтра 30 минут",
    cfg,
    {},
    { now: new Date(2026, 5, 24, 12, 0, 0) },
  );

  assert.equal(draft.canCreateNow, true);
  assert.deepEqual(buildCreateTaskArgs(draft, cfg), {
    title: "позвонить доктору завтра 30 минут",
    projectId: "project-1",
    dueDate: "2026-06-25T00:00:00+0000",
    timeZone: "Europe/Moscow",
    isAllDay: true,
  });
  assert.match(formatTaskDraft(draft), /due: tomorrow 2026-06-25 all-day \(Europe\/Moscow\)/);
});

test("unknown travel duration with route but no time asks for time of day", () => {
  const cfg = config();
  const now = new Date(2026, 5, 24, 12, 0, 0);
  const first = analyzeTaskDraft("go to clinic tomorrow", cfg, {}, { now });
  const draft = refineTaskDraft(first, "I don't know, from home to clinic", cfg, {}, { now });

  assert.equal(draft.canCreateNow, false);
  assert.equal(draft.signals.hasUnknownDuration, true);
  assert.equal(draft.signals.hasLocationHint, true);
  assert.equal(draft.signals.hasTravelEstimate, false);
  assert.match(formatTaskDraft(draft), /What time of day should I estimate for travel/);
});

test("unknown travel duration with route and time creates local estimate", () => {
  const cfg = config({
    TELEGRAM_TRAVEL_DEFAULT_MINUTES: "50",
    TELEGRAM_TRAVEL_BUFFER_MINUTES: "20",
  });
  const now = new Date(2026, 5, 24, 12, 0, 0);
  const first = analyzeTaskDraft("go to clinic tomorrow", cfg, {}, { now });
  const draft = refineTaskDraft(first, "I don't know, from home to clinic at 09:00", cfg, {}, { now });

  assert.equal(draft.canCreateNow, true);
  assert.equal(draft.signals.hasTravelEstimate, true);
  assert.equal(draft.travelEstimate.reserveMinutes, 70);
  assert.match(formatTaskDraft(draft), /travel estimate: 70 minutes/);
  assert.match(formatTaskDraft(draft), /weather\/traffic not checked/);
  assert.deepEqual(buildCreateTaskArgs(draft, cfg), {
    title: "go to clinic tomorrow",
    projectId: "project-1",
    content: [
      "I don't know, from home to clinic at 09:00",
      "travel estimate: 70 minutes\nbasis: local_default\nexternal context checked: false",
    ].join("\n\n"),
    dueDate: "2026-06-25T09:00:00+0000",
    timeZone: "Europe/Moscow",
    isAllDay: false,
  });
});
