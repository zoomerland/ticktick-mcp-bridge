import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSessionStore } from "../src/state-file.mjs";

test("FileSessionStore persists pending actions and profiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "telegram-bot-state-"));
  const path = join(dir, "state.json");
  try {
    const store = new FileSessionStore(path);
    store.setPendingAction("10", { type: "complete_task", taskId: "task-1" });
    store.updateProfile("10", { sleepHours: { startHour: 22, endHour: 7 } });
    store.getProactiveState().lastProactiveSignature = "1:2:3:false";
    store.persist();

    const loaded = new FileSessionStore(path);
    assert.deepEqual(loaded.getPendingAction("10"), { type: "complete_task", taskId: "task-1" });
    assert.deepEqual(loaded.getProfile("10").sleepHours, { startHour: 22, endHour: 7 });
    assert.equal(loaded.getProactiveState().lastProactiveSignature, "1:2:3:false");
    assert.match(readFileSync(path, "utf8"), /complete_task/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
