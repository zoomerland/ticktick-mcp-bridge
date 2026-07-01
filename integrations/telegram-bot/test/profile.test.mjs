import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import {
  applyProfileToConfig,
  effectiveProjectRoutes,
  formatProjectRoutes,
  formatProfile,
  parseProjectRoute,
  updateCheckinProfile,
  updateProjectRouteProfile,
  parseSleepHours,
  updateReminderLeadProfile,
  updateSleepProfile,
} from "../src/secretary/profile.mjs";
import { SessionStore } from "../src/session-store.mjs";

test("parseSleepHours accepts hour windows", () => {
  assert.deepEqual(parseSleepHours("22-7"), { startHour: 22, endHour: 7 });
  assert.equal(parseSleepHours("bad"), null);
});

test("parseProjectRoute accepts keyword project mappings", () => {
  assert.deepEqual(parseProjectRoute("doctor=project-health|Health"), {
    keyword: "doctor",
    projectId: "project-health",
    projectName: "Health",
  });
  assert.equal(parseProjectRoute("bad"), null);
});

test("updateSleepProfile stores sleep hours in session profile", () => {
  const session = new SessionStore();
  const result = updateSleepProfile(session, "10", "23-8");
  assert.equal(result.ok, true);
  assert.deepEqual(session.getProfile("10").sleepHours, { startHour: 23, endHour: 8 });
});

test("updateReminderLeadProfile stores lead minutes", () => {
  const session = new SessionStore();
  const result = updateReminderLeadProfile(session, "10", "45");
  assert.equal(result.ok, true);
  assert.equal(session.getProfile("10").reminderLeadMinutes, 45);
});

test("updateCheckinProfile stores proactive check-in window", () => {
  const session = new SessionStore();
  const result = updateCheckinProfile(session, "10", "10-20");
  assert.equal(result.ok, true);
  assert.deepEqual(session.getProfile("10").checkinHours, { startHour: 10, endHour: 20 });
});

test("updateProjectRouteProfile stores route rules with profile priority", () => {
  const session = new SessionStore();
  const result = updateProjectRouteProfile(session, "10", "doctor=project-health|Health");
  const config = loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_PROJECT_ROUTES: "work=project-work",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(session.getProfile("10").projectRoutes, [{
    keyword: "doctor",
    projectId: "project-health",
    projectName: "Health",
  }]);
  assert.deepEqual(effectiveProjectRoutes(session.getProfile("10"), config).map((route) => route.keyword), [
    "doctor",
    "work",
  ]);
  assert.match(formatProjectRoutes(session.getProfile("10"), config), /doctor -> project-health/);
});

test("applyProfileToConfig overrides quiet hours for proactive review", () => {
  const config = loadConfig({ TELEGRAM_DRY_RUN: "true" });
  const effective = applyProfileToConfig(config, {
    sleepHours: { startHour: 20, endHour: 9 },
    checkinHours: { startHour: 10, endHour: 19 },
  });
  assert.deepEqual(effective.telegram.quietHours, { startHour: 20, endHour: 9 });
  assert.deepEqual(effective.telegram.checkinHours, { startHour: 10, endHour: 19 });
});

test("formatProfile reports effective quiet hours", () => {
  const config = loadConfig({ TELEGRAM_DRY_RUN: "true", TELEGRAM_QUIET_HOURS: "21-6" });
  assert.match(formatProfile({}, config), /21-6/);
  assert.match(formatProfile({}, config), /9-21/);
  assert.match(formatProfile({}, config), /30m/);
  assert.match(formatProfile({}, config), /project routes: 0/);
  assert.match(formatProfile({ sleepHours: { startHour: 23, endHour: 8 } }, config), /23-8/);
});
