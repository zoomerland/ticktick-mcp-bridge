import assert from "node:assert/strict";
import { officialTaskPayload } from "../src/tools.mjs";
import {
  apiProjectId,
  INBOX_PROJECT,
  isInboxProjectId,
  projectNameById,
  withInboxProject,
} from "../src/ticktick-data.mjs";

const regularProjects = [
  { id: "project-a", name: "Project A" },
  { id: "project-b", name: "Project B" },
];

const withInbox = withInboxProject(regularProjects);
assert.equal(withInbox[0].id, "inbox");
assert.equal(withInbox[0].name, "Inbox");
assert.equal(withInbox.length, 3);

const alreadyHasInbox = withInboxProject([INBOX_PROJECT, ...regularProjects]);
assert.equal(alreadyHasInbox.filter((project) => project.id === "inbox").length, 1);

assert.equal(isInboxProjectId("inbox"), true);
assert.equal(isInboxProjectId("Inbox"), true);
assert.equal(isInboxProjectId("inbox131473281"), true);
assert.equal(isInboxProjectId("project-a"), false);
assert.equal(apiProjectId("inbox131473281"), "inbox");
assert.equal(apiProjectId("project-a"), "project-a");
assert.deepEqual(officialTaskPayload({ id: "task-1", projectId: "inbox131473281", title: "Inbox task" }), {
  id: "task-1",
  projectId: "inbox",
  title: "Inbox task",
});
assert.deepEqual(officialTaskPayload({ id: "task-1", projectId: "project-a", title: "Project task" }), {
  id: "task-1",
  projectId: "project-a",
  title: "Project task",
});
assert.deepEqual(officialTaskPayload({
  id: "task-1",
  projectId: "project-a",
  startDate: null,
  dueDate: null,
  content: "",
  title: undefined,
}), {
  id: "task-1",
  projectId: "project-a",
  startDate: null,
  dueDate: null,
});

const names = projectNameById(withInbox);
assert.equal(names.inbox, "Inbox");
assert.equal(names["project-a"], "Project A");

console.log("Inbox regression tests passed.");
