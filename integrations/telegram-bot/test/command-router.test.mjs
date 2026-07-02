import test from "node:test";
import assert from "node:assert/strict";
import { handleUpdate, parseCommand, routeText } from "../src/command-router.mjs";
import { loadConfig } from "../src/config.mjs";
import { RateLimiter } from "../src/rate-limit.mjs";
import { SessionStore } from "../src/session-store.mjs";

function config(overrides = {}) {
  return loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: "10",
    TELEGRAM_CONFIRM_WRITES: "true",
    TELEGRAM_MAX_RESULTS: "2",
    ...overrides,
  });
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function ticktickDueDateDaysFromNow(dayOffset, time = "00:00") {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `T${time}:00+0000`,
  ].join("");
}

function update(text, userId = 10) {
  return {
    message: {
      text,
      from: { id: userId },
      chat: { id: userId, type: "private" },
    },
  };
}

function voiceUpdate(userId = 10) {
  return {
    message: {
      voice: { file_id: "voice-1", duration: 12, mime_type: "audio/ogg" },
      from: { id: userId },
      chat: { id: userId, type: "private" },
    },
  };
}

test("parseCommand handles bot mentions and args", () => {
  assert.deepEqual(parseCommand("/today@secretary next7"), {
    command: "today",
    argsText: "next7",
  });
});

test("parseCommand supports Russian slash aliases", () => {
  assert.deepEqual(parseCommand("/сегодня"), {
    command: "today",
    argsText: "",
  });
  assert.deepEqual(parseCommand("/поиск доктор"), {
    command: "search",
    argsText: "доктор",
  });
  assert.deepEqual(parseCommand("/маршруты"), {
    command: "routes",
    argsText: "",
  });
  assert.deepEqual(parseCommand("/проекты"), {
    command: "projects",
    argsText: "",
  });
});

test("read-only commands call expected bridge tools", async () => {
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return { tasks: [{ title: "Task", projectName: "Inbox", dueBucket: "today" }] };
    },
  };

  const result = await routeText("/today", { bridge, config: config() });
  assert.equal(calls[0].name, "ticktick_today");
  assert.match(result.text, /Today and overdue/);
  assert.match(result.text, /Today/);
});

test("projects command lists project ids without write tools", async () => {
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name !== "ticktick_list_projects") throw new Error(`unexpected tool ${name}`);
      return [
        { id: "inbox", name: "Inbox", isInbox: true },
        { id: "project-work", name: "Work" },
        { id: "project-personal", name: "Personal" },
      ];
    },
  };

  const result = await routeText("/projects", { bridge, config: config() });

  assert.equal(result.kind, "bridge");
  assert.equal(result.tool, "ticktick_list_projects");
  assert.deepEqual(calls, [{ name: "ticktick_list_projects", args: {} }]);
  assert.match(result.text, /Projects/);
  assert.match(result.text, /Inbox \(inbox\)/);
  assert.match(result.text, /Work \(project-work\)/);
  assert.doesNotMatch(result.text, /Personal/);
  assert.match(result.text, /\.\.\.and 1 more\./);
  assert.equal(calls.some((call) => /create|update|delete|complete|move/i.test(call.name)), false);
});

test("natural Russian day question routes to today without creating a task", async () => {
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return { tasks: [{ title: "Today task", projectName: "Work", dueBucket: "today" }] };
    },
  };

  const result = await routeText("что у меня сегодня", { bridge, config: config() });

  assert.equal(result.kind, "bridge");
  assert.equal(result.tool, "ticktick_today");
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);
  assert.match(result.text, /Today task/);
});

test("natural reminder question routes to upcoming reminders", async () => {
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return {
        tasks: [
          { title: "Soon task", dueBucket: "today", dueDate: "2026-06-24T10:20:00+0000" },
        ],
      };
    },
  };

  const result = await routeText("что дальше", { bridge, config: config() });

  assert.equal(result.kind, "bridge");
  assert.equal(result.tool, "secretary_upcoming_reminders");
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);
  assert.match(result.text, /Upcoming reminders/);
});

test("pending draft keeps natural timing answers as draft refinements", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = { callTool: async (...args) => calls.push(args) };
  const cfg = config();

  await routeText("/add call doctor", { bridge, config: cfg, session });
  const result = await routeText("сегодня", { bridge, config: cfg, session });

  assert.equal(result.kind, "task_draft");
  assert.equal(calls.length, 0);
  assert.match(result.text, /Task draft/);
});

test("pending travel draft captures duration replies and stops asking trip duration", async () => {
  for (const answer of ["30 minutes", "30 min", "полчаса", "40 минут"]) {
    const session = new SessionStore();
    const calls = [];
    const bridge = { callTool: async (...args) => calls.push(args) };
    const cfg = config();

    const first = await routeText("/add go to clinic tomorrow", { bridge, config: cfg, session });
    const result = await routeText(answer, { bridge, config: cfg, session });

    assert.match(first.text, /How long should I reserve/);
    assert.equal(result.kind, "task_draft");
    assert.equal(calls.length, 0);
    assert.match(result.text, /captured details:/);
    assert.ok(result.text.includes(answer));
    assert.doesNotMatch(result.text, /How long should I reserve/);
    assert.doesNotMatch(result.text, /from where to where/);
  }
});

test("pending travel draft captures route context without repeating route question", async () => {
  for (const answer of ["I do not know, from home to the clinic", "не знаю, от дома до клиники"]) {
    const session = new SessionStore();
    const calls = [];
    const bridge = { callTool: async (...args) => calls.push(args) };
    const cfg = config();

    const first = await routeText("/add go to clinic tomorrow", { bridge, config: cfg, session });
    const result = await routeText(answer, { bridge, config: cfg, session });

    assert.match(first.text, /from where to where/);
    assert.equal(result.kind, "task_draft");
    assert.equal(calls.length, 0);
    assert.match(result.text, /captured details:/);
    assert.ok(result.text.includes(answer));
    if (answer.startsWith("I do not know")) {
      assert.match(result.text, /What time of day should I estimate for travel/);
      assert.doesNotMatch(result.text, /How long should I reserve/);
    } else {
      assert.match(result.text, /How long should I reserve/);
    }
    assert.doesNotMatch(result.text, /from where to where/);
  }
});

test("exact natural cancel clears pending draft", async () => {
  const session = new SessionStore();
  const bridge = { callTool: async () => { throw new Error("should not call bridge"); } };
  const cfg = config();

  await routeText("/add call doctor", { bridge, config: cfg, session });
  const result = await routeText("отмена", { bridge, config: cfg, session });

  assert.equal(result.kind, "cancelled");
  assert.match(result.text, /cancelled/);
});

test("brief gathers today and inbox before producing a secretary summary", async () => {
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_today") {
        return {
          tasks: [
            { title: "Late item", dueBucket: "overdue", priority: 5 },
            { title: "Today item", dueBucket: "today", priority: 1 },
          ],
        };
      }
      if (name === "ticktick_inbox") return [{ title: "Clarify trip" }];
      throw new Error(`unexpected tool ${name}`);
    },
  };

  const result = await routeText("/brief", { bridge, config: config() });
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today", "ticktick_inbox"]);
  assert.match(result.text, /Daily brief/);
  assert.match(result.text, /Suggested focus: clear or reschedule overdue items first/);
  assert.match(result.text, /Clarify trip/);
});

test("inbox supports array responses from bridge", async () => {
  const bridge = {
    async callTool() {
      return [{ title: "Inbox task", projectName: "Inbox" }];
    },
  };

  const result = await routeText("/inbox", { bridge, config: config() });
  assert.match(result.text, /Inbox task/);
});

test("search formats object responses with candidates", async () => {
  const bridge = {
    async callTool(name, args) {
      assert.equal(name, "ticktick_search_tasks");
      assert.equal(args.query, "доктор");
      return {
        query: "доктор",
        count: 1,
        tasks: [{ title: "Поездка к доктору", projectName: "Личный" }],
      };
    },
  };

  const result = await routeText("/search доктор", { bridge, config: config() });
  assert.match(result.text, /Поездка к доктору/);
});

test("plain text becomes a task draft with travel clarification", async () => {
  const result = await routeText("надо поехать к доктору завтра", {
    bridge: { callTool: async () => { throw new Error("should not call bridge"); } },
    config: config(),
  });
  assert.equal(result.kind, "task_draft");
  assert.match(result.text, /Task draft/);
  assert.match(result.text, /travel or appointment/);
  assert.match(result.text, /How long should I reserve/);
  assert.match(result.text, /from where to where/);
});

test("late plain text becomes a schedule repair draft", async () => {
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return {
        tasks: [
          { title: "Late item", dueBucket: "overdue", priority: 5 },
        ],
      };
    },
  };
  const result = await routeText("я не успеваю это сделать", {
    bridge,
    config: config(),
    session: new SessionStore(),
  });

  assert.equal(result.kind, "schedule_repair");
  assert.equal(calls[0].name, "ticktick_today");
  assert.match(result.text, /Schedule repair draft/);
  assert.match(result.text, /No changes have been written/);
});

test("capture command validates text", async () => {
  const result = await routeText("/capture", {
    bridge: { callTool: async () => ({}) },
    config: config(),
  });
  assert.equal(result.kind, "invalid");
});

test("add stores a complete draft and confirm creates a TickTick task", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return { id: "task-1", title: args.title };
    },
  };
  const cfg = config({ TELEGRAM_DEFAULT_PROJECT_ID: "project-1" });

  const draft = await routeText("/add call doctor tomorrow 30 min", {
    bridge,
    config: cfg,
    session,
  });
  assert.equal(draft.kind, "task_draft");
  assert.match(draft.text, /Ready to create/);
  assert.match(draft.text, /due: tomorrow .* all-day \(Europe\/Moscow\)/);

  const confirmed = await routeText("/confirm", { bridge, config: cfg, session });
  assert.equal(confirmed.kind, "created_task");
  assert.deepEqual(calls, [{
    name: "ticktick_create_task",
    args: {
      title: "call doctor tomorrow 30 min",
      projectId: "project-1",
      dueDate: ticktickDueDateDaysFromNow(1),
      timeZone: "Europe/Moscow",
      isAllDay: true,
    },
  }]);
  assert.match(confirmed.text, /Task created/);
});

test("add captures a simple 24h clock as a timed due date", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return { id: "task-1", title: args.title };
    },
  };
  const cfg = config({ TELEGRAM_DEFAULT_PROJECT_ID: "project-1" });

  const draft = await routeText("/add call doctor today 15:30 30 min", {
    bridge,
    config: cfg,
    session,
  });
  assert.equal(draft.kind, "task_draft");
  assert.match(draft.text, /due: today .* 15:30 \(Europe\/Moscow\)/);

  const confirmed = await routeText("/confirm", { bridge, config: cfg, session });
  assert.equal(confirmed.kind, "created_task");
  assert.deepEqual(calls, [{
    name: "ticktick_create_task",
    args: {
      title: "call doctor today 15:30 30 min",
      projectId: "project-1",
      dueDate: ticktickDueDateDaysFromNow(0, "15:30"),
      timeZone: "Europe/Moscow",
      isAllDay: false,
    },
  }]);
});

test("set-route lets add choose a project without asking project question", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return { id: "task-1", title: args.title };
    },
  };
  const cfg = config();

  const saved = await routeText("/set-route doctor=project-health|Health", {
    bridge,
    config: cfg,
    session,
  });
  const routes = await routeText("/routes", { bridge, config: cfg, session });
  const draft = await routeText("/add call doctor tomorrow 30 min", {
    bridge,
    config: cfg,
    session,
  });
  const confirmed = await routeText("/confirm", { bridge, config: cfg, session });

  assert.equal(saved.kind, "profile_updated");
  assert.match(routes.text, /doctor -> project-health/);
  assert.equal(draft.kind, "task_draft");
  assert.match(draft.text, /project route: doctor -> Health \(project-health\)/);
  assert.doesNotMatch(draft.text, /Which TickTick list/);
  assert.equal(confirmed.kind, "created_task");
  assert.deepEqual(calls, [{
    name: "ticktick_create_task",
    args: {
      title: "call doctor tomorrow 30 min",
      projectId: "project-health",
      dueDate: ticktickDueDateDaysFromNow(1),
      timeZone: "Europe/Moscow",
      isAllDay: true,
    },
  }]);
});

test("set-checkins stores proactive initiative window", async () => {
  const session = new SessionStore();
  const result = await routeText("/set-checkins 10-20", {
    bridge: { callTool: async () => ({}) },
    config: config(),
    session,
  });
  const profile = await routeText("/profile", {
    bridge: { callTool: async () => ({}) },
    config: config(),
    session,
  });

  assert.equal(result.kind, "profile_updated");
  assert.match(result.text, /10-20/);
  assert.match(profile.text, /check-in hours: 10-20/);
});

test("confirm refuses incomplete drafts without bridge writes", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = { callTool: async (...args) => calls.push(args) };
  const cfg = config();

  await routeText("/add call doctor", { bridge, config: cfg, session });
  const result = await routeText("/confirm", { bridge, config: cfg, session });

  assert.equal(result.kind, "invalid");
  assert.equal(calls.length, 0);
  assert.match(result.text, /Cannot create yet/);
});

test("confirm respects TELEGRAM_CONFIRM_WRITES=false kill switch", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_find_task_candidates") {
        return {
          tasks: [{ id: "task-1", projectId: "project-1", title: "Call doctor" }],
          decision: { status: "single_candidate", canAct: true, taskId: "task-1", projectId: "project-1" },
        };
      }
      throw new Error(`unexpected write ${name}`);
    },
  };

  const draft = await routeText("/complete doctor", { bridge, config: config(), session });
  const confirmed = await routeText("/confirm", {
    bridge,
    config: config({ TELEGRAM_CONFIRM_WRITES: "false" }),
    session,
  });

  assert.equal(draft.kind, "complete_draft");
  assert.equal(confirmed.kind, "writes_disabled");
  assert.match(confirmed.text, /TELEGRAM_CONFIRM_WRITES=false/);
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_find_task_candidates"]);
});

test("starting a task draft clears an older pending action", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_find_task_candidates") {
        return {
          tasks: [{ id: "task-1", projectId: "project-1", title: "Call doctor" }],
          decision: { status: "single_candidate", canAct: true, taskId: "task-1", projectId: "project-1" },
        };
      }
      if (name === "ticktick_create_task") {
        return { id: "created-1", title: args.title };
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
  const cfg = config({ TELEGRAM_DEFAULT_PROJECT_ID: "project-1" });

  await routeText("/complete doctor", { bridge, config: cfg, session });
  await routeText("/add buy milk today", { bridge, config: cfg, session });
  const confirmed = await routeText("/confirm", { bridge, config: cfg, session });

  assert.equal(confirmed.kind, "created_task");
  assert.deepEqual(calls.map((call) => call.name), [
    "ticktick_find_task_candidates",
    "ticktick_create_task",
  ]);
});

test("starting a pending action clears an older task draft", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_find_task_candidates") {
        return {
          tasks: [{ id: "task-1", projectId: "project-1", title: "Call doctor" }],
          decision: { status: "single_candidate", canAct: true, taskId: "task-1", projectId: "project-1" },
        };
      }
      if (name === "ticktick_complete_task_safe") {
        return { acted: true, projectId: args.projectId, taskId: args.taskId };
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
  const cfg = config({ TELEGRAM_DEFAULT_PROJECT_ID: "project-1" });

  await routeText("/add buy milk today", { bridge, config: cfg, session });
  await routeText("/complete doctor", { bridge, config: cfg, session });
  const confirmed = await routeText("/confirm", { bridge, config: cfg, session });
  const secondConfirm = await routeText("/confirm", { bridge, config: cfg, session });

  assert.equal(confirmed.kind, "completed_task");
  assert.equal(secondConfirm.kind, "invalid");
  assert.match(secondConfirm.text, /No pending task draft/);
  assert.deepEqual(calls.map((call) => call.name), [
    "ticktick_find_task_candidates",
    "ticktick_complete_task_safe",
  ]);
});

test("cancel clears a pending draft", async () => {
  const session = new SessionStore();
  const bridge = { callTool: async () => ({}) };
  const cfg = config();

  await routeText("/capture call doctor", { bridge, config: cfg, session });
  const cancelled = await routeText("/cancel", { bridge, config: cfg, session });
  const confirm = await routeText("/confirm", { bridge, config: cfg, session });

  assert.match(cancelled.text, /cancelled/);
  assert.match(confirm.text, /No pending task draft/);
});

test("complete stores a safe candidate and confirm completes it", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_find_task_candidates") {
        return {
          tasks: [{ id: "task-1", projectId: "project-1", title: "Call doctor", projectName: "Personal" }],
          decision: { status: "single_candidate", canAct: true, taskId: "task-1", projectId: "project-1" },
        };
      }
      if (name === "ticktick_complete_task_safe") {
        return { acted: true, projectId: args.projectId, taskId: args.taskId };
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };

  const draft = await routeText("/complete doctor", { bridge, config: config(), session });
  assert.equal(draft.kind, "complete_draft");
  assert.match(draft.text, /Complete task draft/);

  const confirmed = await routeText("/confirm", { bridge, config: config(), session });
  assert.equal(confirmed.kind, "completed_task");
  assert.deepEqual(calls.map((call) => call.name), [
    "ticktick_find_task_candidates",
    "ticktick_complete_task_safe",
  ]);
  assert.deepEqual(calls[1].args, { projectId: "project-1", taskId: "task-1" });
});

test("complete shows ambiguous candidates without pending action", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return {
        tasks: [
          { id: "a", projectId: "p", title: "Doctor appointment" },
          { id: "b", projectId: "p", title: "Call doctor" },
        ],
        decision: { status: "ambiguous", canAct: false, reason: "Multiple matching tasks were found." },
      };
    },
  };

  const result = await routeText("/complete doctor", { bridge, config: config(), session });
  const confirm = await routeText("/confirm", { bridge, config: config(), session });

  assert.equal(result.kind, "complete_candidates");
  assert.match(result.text, /No task was completed/);
  assert.match(confirm.text, /No pending task draft/);
  assert.equal(calls.length, 1);
});

test("postpone-today stores repair action and confirm updates selected tasks", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_today") {
        return {
          tasks: [
            { id: "task-low", projectId: "project-1", title: "Low today", dueBucket: "today", priority: 1 },
            { id: "task-high", projectId: "project-1", title: "High today", dueBucket: "today", priority: 5 },
          ],
        };
      }
      if (name === "ticktick_update_task") return { id: args.taskId, updated: true };
      throw new Error(`unexpected tool ${name}`);
    },
  };

  const draft = await routeText("/postpone-today tomorrow", { bridge, config: config(), session });
  assert.equal(draft.kind, "postpone_draft");
  assert.match(draft.text, /Low today/);
  assert.doesNotMatch(draft.text, /High today/);

  const confirmed = await routeText("/confirm", { bridge, config: config(), session });
  assert.equal(confirmed.kind, "postponed_tasks");
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today", "ticktick_update_task"]);
  assert.equal(calls[1].args.taskId, "task-low");
  assert.equal(calls[1].args.isAllDay, true);
});

test("postpone-today all stores repair action for all today tasks", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_today") {
        return {
          tasks: [
            { id: "task-low", projectId: "project-1", title: "Low today", dueBucket: "today", priority: 1 },
            { id: "task-high", projectId: "project-1", title: "High today", dueBucket: "today", priority: 5 },
            { id: "task-late", projectId: "project-1", title: "Late", dueBucket: "overdue", priority: 1 },
          ],
        };
      }
      if (name === "ticktick_update_task") return { id: args.taskId, updated: true };
      throw new Error(`unexpected tool ${name}`);
    },
  };

  const draft = await routeText("/postpone-today all tomorrow", { bridge, config: config(), session });
  assert.equal(draft.kind, "postpone_draft");
  assert.match(draft.text, /mode: all_today/);
  assert.match(draft.text, /Low today/);
  assert.match(draft.text, /High today/);
  assert.doesNotMatch(draft.text, /Late/);

  const confirmed = await routeText("/confirm", { bridge, config: config(), session });
  assert.equal(confirmed.kind, "postponed_tasks");
  assert.deepEqual(calls.map((call) => call.name), [
    "ticktick_today",
    "ticktick_update_task",
    "ticktick_update_task",
  ]);
  assert.deepEqual(calls.slice(1).map((call) => call.args.taskId), ["task-low", "task-high"]);
});

test("postpone-today rest keeps highest-priority today tasks and waits for confirm", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_today") {
        return {
          tasks: [
            { id: "task-main", projectId: "project-1", title: "Main today", dueBucket: "today", priority: 5 },
            { id: "task-rest", projectId: "project-1", title: "Rest today", dueBucket: "today", priority: 2 },
            { id: "task-late", projectId: "project-1", title: "Late", dueBucket: "overdue", priority: 1 },
          ],
        };
      }
      if (name === "ticktick_update_task") return { id: args.taskId, updated: true };
      throw new Error(`unexpected tool ${name}`);
    },
  };

  const draft = await routeText("/postpone-today rest tomorrow", { bridge, config: config(), session });
  assert.equal(draft.kind, "postpone_draft");
  assert.match(draft.text, /mode: rest_today/);
  assert.match(draft.text, /kept: 1/);
  assert.match(draft.text, /Main today/);
  assert.match(draft.text, /Rest today/);
  assert.doesNotMatch(draft.text, /Late/);
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);

  const confirmed = await routeText("/confirm", { bridge, config: config(), session });
  assert.equal(confirmed.kind, "postponed_tasks");
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today", "ticktick_update_task"]);
  assert.equal(calls[1].args.taskId, "task-rest");
});

test("natural postpone tomorrow stores repair action and waits for confirm", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_today") {
        return {
          tasks: [
            { id: "task-low", projectId: "project-1", title: "Low today", dueBucket: "today", priority: 1 },
          ],
        };
      }
      if (name === "ticktick_update_task") return { id: args.taskId, updated: true };
      throw new Error(`unexpected tool ${name}`);
    },
  };

  const draft = await routeText("move today's lower priority tasks tomorrow", {
    bridge,
    config: config(),
    session,
  });

  assert.equal(draft.kind, "postpone_draft");
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);
  assert.match(draft.text, /Send \/confirm/);

  const confirmed = await routeText("/confirm", { bridge, config: config(), session });
  assert.equal(confirmed.kind, "postponed_tasks");
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today", "ticktick_update_task"]);
});

test("natural Russian rest-today postpone stores repair action and waits for confirm", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_today") {
        return {
          tasks: [
            { id: "task-main", projectId: "project-1", title: "Главное", dueBucket: "today", priority: 5 },
            { id: "task-rest", projectId: "project-1", title: "Остальное", dueBucket: "today", priority: 1 },
          ],
        };
      }
      if (name === "ticktick_update_task") return { id: args.taskId, updated: true };
      throw new Error(`unexpected tool ${name}`);
    },
  };

  const draft = await routeText("оставь главное, перенеси остальное на завтра", {
    bridge,
    config: config(),
    session,
  });

  assert.equal(draft.kind, "postpone_draft");
  assert.match(draft.text, /mode: rest_today/);
  assert.match(draft.text, /Главное/);
  assert.match(draft.text, /Остальное/);
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);

  const confirmed = await routeText("/confirm", { bridge, config: config(), session });
  assert.equal(confirmed.kind, "postponed_tasks");
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today", "ticktick_update_task"]);
  assert.equal(calls[1].args.taskId, "task-rest");
});

test("natural cancel today's plans stores all-today repair action and waits for confirm", async () => {
  const session = new SessionStore();
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "ticktick_today") {
        return {
          tasks: [
            { id: "task-low", projectId: "project-1", title: "Low today", dueBucket: "today", priority: 1 },
            { id: "task-high", projectId: "project-1", title: "High today", dueBucket: "today", priority: 5 },
          ],
        };
      }
      if (name === "ticktick_update_task") return { id: args.taskId, updated: true };
      throw new Error(`unexpected tool ${name}`);
    },
  };

  const draft = await routeText("cancel today's plans", {
    bridge,
    config: config(),
    session,
  });

  assert.equal(draft.kind, "postpone_draft");
  assert.match(draft.text, /mode: all_today/);
  assert.match(draft.text, /Send \/confirm/);
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);

  const confirmed = await routeText("/confirm", { bridge, config: config(), session });
  assert.equal(confirmed.kind, "postponed_tasks");
  assert.deepEqual(calls.map((call) => call.name), [
    "ticktick_today",
    "ticktick_update_task",
    "ticktick_update_task",
  ]);
});

test("search requires a query", async () => {
  const result = await routeText("/search", {
    bridge: { callTool: async () => ({}) },
    config: config(),
  });
  assert.equal(result.kind, "invalid");
});

test("unsupported mutation commands are blocked before confirmation implementation", async () => {
  const calls = [];
  const result = await routeText("/move call doctor", {
    bridge: { callTool: async (...args) => calls.push(args) },
    config: config(),
  });
  assert.equal(result.kind, "blocked_write");
  assert.equal(calls.length, 0);
});

test("unauthorized update is denied before routing", async () => {
  const reply = await handleUpdate(update("/today", 11), {
    bridge: { callTool: async () => { throw new Error("should not call bridge"); } },
    config: config(),
    rateLimiter: new RateLimiter({ windowMs: 60000, maxCommands: 10 }),
  });
  assert.equal(reply.authorized, false);
  assert.equal(reply.text, "Access denied.");
});

test("authorized voice update gets safe no-transcription response", async () => {
  const reply = await handleUpdate(voiceUpdate(), {
    bridge: { callTool: async () => { throw new Error("should not call bridge"); } },
    config: config(),
    rateLimiter: new RateLimiter({ windowMs: 60000, maxCommands: 10 }),
    session: new SessionStore(),
  });

  assert.equal(reply.kind, "voice_received");
  assert.match(reply.text, /Voice message received/);
  assert.match(reply.text, /not enabled/);
});

test("authorized voice update with mock transcript routes through text flow", async () => {
  const calls = [];
  const reply = await handleUpdate(voiceUpdate(), {
    bridge: {
      async callTool(name, args) {
        calls.push({ name, args });
        return {
          tasks: [
            { title: "Soon task", dueBucket: "today", dueDate: "2026-06-24T10:20:00+0000" },
          ],
        };
      },
    },
    config: config({
      TELEGRAM_VOICE_ENABLED: "true",
      TELEGRAM_VOICE_PROVIDER: "mock",
      TELEGRAM_VOICE_MOCK_TRANSCRIPT: "what is next",
    }),
    rateLimiter: new RateLimiter({ windowMs: 60000, maxCommands: 10 }),
    session: new SessionStore(),
  });

  assert.equal(reply.kind, "voice_bridge");
  assert.match(reply.text, /Voice transcript accepted/);
  assert.match(reply.text, /Routed as text/);
  assert.match(reply.text, /Upcoming reminders/);
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);
});

test("authorized voice update with http provider fails closed without audio payload", async () => {
  const calls = [];
  const reply = await handleUpdate(voiceUpdate(), {
    bridge: { callTool: async (...args) => calls.push(args) },
    config: config({
      TELEGRAM_VOICE_ENABLED: "true",
      TELEGRAM_VOICE_PROVIDER: "http",
      TELEGRAM_VOICE_HTTP_URL: "http://127.0.0.1:9876/transcribe",
    }),
    rateLimiter: new RateLimiter({ windowMs: 60000, maxCommands: 10 }),
    session: new SessionStore(),
  });

  assert.equal(reply.kind, "voice_received");
  assert.match(reply.text, /download is disabled/);
  assert.equal(calls.length, 0);
});

test("authorized voice update can download small voice and route http transcript", async () => {
  const bridgeCalls = [];
  const telegramCalls = [];
  const voiceRequests = [];
  const logLines = [];
  const reply = await handleUpdate(voiceUpdate(), {
    bridge: {
      async callTool(name, args) {
        bridgeCalls.push({ name, args });
        return {
          tasks: [
            { title: "Soon task", dueBucket: "today", dueDate: "2026-06-24T10:20:00+0000" },
          ],
        };
      },
    },
    config: config({
      TELEGRAM_VOICE_ENABLED: "true",
      TELEGRAM_VOICE_PROVIDER: "http",
      TELEGRAM_VOICE_DOWNLOAD_ENABLED: "true",
      TELEGRAM_VOICE_MAX_BYTES: "10",
      TELEGRAM_VOICE_HTTP_URL: "http://127.0.0.1:9876/transcribe",
    }),
    telegram: {
      async getFile(fileId) {
        telegramCalls.push(["getFile", fileId]);
        return { file_path: "voice/file.ogg", file_size: 3 };
      },
      async downloadFileBytes(filePath) {
        telegramCalls.push(["downloadFileBytes", filePath]);
        return Uint8Array.from([1, 2, 3]);
      },
    },
    voiceFetchImpl: async (url, request) => {
      voiceRequests.push({ url, body: JSON.parse(request.body) });
      return {
        ok: true,
        json: async () => ({
          text: "what is next",
          provider: "sensevoice_resident",
          audioBytes: 3,
          elapsedMs: 321,
          requestElapsedMs: 456,
        }),
      };
    },
    rateLimiter: new RateLimiter({ windowMs: 60000, maxCommands: 10 }),
    session: new SessionStore(),
    logger: { info: (line) => logLines.push(line) },
  });

  assert.equal(reply.kind, "voice_bridge");
  assert.match(reply.text, /provider: sensevoice_resident/);
  assert.match(reply.text, /Upcoming reminders/);
  assert.deepEqual(telegramCalls, [["getFile", "voice-1"], ["downloadFileBytes", "voice/file.ogg"]]);
  assert.equal(voiceRequests.length, 1);
  assert.equal(voiceRequests[0].body.audioBase64, "AQID");
  assert.deepEqual(bridgeCalls.map((call) => call.name), ["ticktick_today"]);
  assert.equal(logLines.length, 1);
  const event = JSON.parse(logLines[0]);
  assert.equal(event.event, "telegram_voice_pipeline_timing");
  assert.equal(event.status, "ok");
  assert.equal(event.provider, "sensevoice_resident");
  assert.equal(event.voiceDurationSec, 12);
  assert.equal(event.audioBytes, 3);
  assert.equal(event.timings.sttProviderElapsedMs, 321);
  assert.equal(event.timings.sttRequestElapsedMs, 456);
  assert.equal(event.timings.audioBytes, 3);
  assert.equal(typeof event.timings.totalMs, "number");
  assert.doesNotMatch(logLines[0], /what is next/);
  assert.doesNotMatch(logLines[0], /Soon task/);
});

test("authorized voice update drops low-signal http transcript before LLM routing", async () => {
  const bridgeCalls = [];
  const logLines = [];
  const reply = await handleUpdate(voiceUpdate(), {
    bridge: { callTool: async (...args) => bridgeCalls.push(args) },
    config: config({
      TELEGRAM_VOICE_ENABLED: "true",
      TELEGRAM_VOICE_PROVIDER: "http",
      TELEGRAM_VOICE_DOWNLOAD_ENABLED: "true",
      TELEGRAM_VOICE_MAX_BYTES: "10",
      TELEGRAM_VOICE_HTTP_URL: "http://127.0.0.1:9876/transcribe",
    }),
    telegram: {
      async getFile() {
        return { file_path: "voice/file.wav", file_size: 3 };
      },
      async downloadFileBytes() {
        return Uint8Array.from([1, 2, 3]);
      },
    },
    voiceFetchImpl: async () => ({
      ok: true,
      json: async () => ({
        text: "on.",
        provider: "sensevoice_resident",
        audioBytes: 3,
        elapsedMs: 321,
        requestElapsedMs: 456,
      }),
    }),
    rateLimiter: new RateLimiter({ windowMs: 60000, maxCommands: 10 }),
    session: new SessionStore(),
    llmClient: { chat: async () => { throw new Error("should not call LLM"); } },
    logger: { info: (line) => logLines.push(line) },
  });

  assert.equal(reply.kind, "voice_received");
  assert.match(reply.text, /too short or unclear/);
  assert.equal(bridgeCalls.length, 0);
  assert.equal(logLines.length, 1);
  const event = JSON.parse(logLines[0]);
  assert.equal(event.status, "low_signal_transcript");
  assert.equal(event.provider, "sensevoice_resident");
  assert.equal(event.timings.sttProviderElapsedMs, 321);
  assert.equal(typeof event.timings.totalMs, "number");
  assert.doesNotMatch(logLines[0], /on\./);
});
