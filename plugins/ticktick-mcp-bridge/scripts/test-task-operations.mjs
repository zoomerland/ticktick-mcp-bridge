import assert from "node:assert/strict";
import { candidateDecision, rankTaskCandidates, scoreTaskMatch, tokenizeQuery } from "../src/task-operations.mjs";
import { normalizeTask } from "../src/ticktick-data.mjs";

const project = { id: "inbox", name: "Inbox", isInbox: true };
const tasks = [
  normalizeTask({
    id: "task-electricity-statement",
    title: "Написать обращение в бытовую компанию по электричеству",
    content: "Отправить заявление по электроэнергии",
    projectId: "inbox131473281",
    dueDate: "2026-06-01T00:00:00+0000",
    priority: 5,
    tags: ["дом"],
    status: 0,
  }, project),
  normalizeTask({
    id: "task-electricity-payment",
    title: "Оплатить электричество",
    content: "Проверить начисления",
    projectId: "inbox131473281",
    priority: 1,
    status: 0,
  }, project),
  normalizeTask({
    id: "task-market",
    title: "Купить продукты",
    content: "Молоко и хлеб",
    projectId: "project-a",
    status: 0,
  }, { id: "project-a", name: "Home" }),
];

assert.deepEqual(tokenizeQuery("электроэнергии заявление"), ["электроэнергии", "заявление"]);

const score = scoreTaskMatch(tasks[0], "заявление электроэнергии");
assert.ok(score.score > 0);
assert.ok(score.matchedKeywords.includes("заявление"));
assert.ok(scoreTaskMatch(tasks[0], "обращение электричество").score > 0);
assert.equal(scoreTaskMatch(tasks[2], "электричество").score, 0);

const ranked = rankTaskCandidates(tasks, "электроэнергии заявление");
assert.equal(ranked[0].id, "task-electricity-statement");
assert.equal(ranked[0].apiProjectId, "inbox");
assert.equal(ranked.length, 2);
assert.equal(candidateDecision(ranked).canAct, false);

const ambiguous = rankTaskCandidates(tasks, "электр");
assert.equal(ambiguous.length, 2);
assert.equal(candidateDecision(ambiguous).canAct, false);
assert.equal(candidateDecision(ambiguous).status, "ambiguous");

const statementWord = tasks[0].content.split(" ")[1];
const single = candidateDecision(rankTaskCandidates(tasks, statementWord));
assert.equal(single.canAct, true);
assert.equal(single.taskId, "task-electricity-statement");
assert.equal(single.projectId, "inbox131473281");

console.log("Task operation regression tests passed.");
