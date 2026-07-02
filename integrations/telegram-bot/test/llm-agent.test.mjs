import test from "node:test";
import assert from "node:assert/strict";
import { routeText } from "../src/command-router.mjs";
import { loadConfig } from "../src/config.mjs";
import { llmAgentInternals } from "../src/secretary/llm-agent.mjs";
import { SessionStore } from "../src/session-store.mjs";

function config(overrides = {}) {
  return loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: "10",
    TELEGRAM_CONFIRM_WRITES: "true",
    TELEGRAM_LLM_ENABLED: "true",
    ...overrides,
  });
}

class FakeLlmClient {
  constructor(responses) {
    this.responses = [...responses];
    this.calls = [];
  }

  async chat(request) {
    this.calls.push(request);
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return {
      content: typeof response === "string" ? response : JSON.stringify(response),
      raw: {},
    };
  }
}

test("LLM narrator normalizes Russian formal address", () => {
  assert.equal(
    llmAgentInternals.normalizeNarratedText("У вас 2 задачи, и у вас есть просрочка."),
    "У тебя 2 задачи, и у тебя есть просрочка.",
  );
});

test("LLM chat mode answers without calling TickTick bridge", async () => {
  const llmClient = new FakeLlmClient([
    "That sounds like a priority tradeoff. I would first protect the one task with the biggest consequence.",
  ]);
  const calls = [];

  const result = await routeText("I feel overwhelmed; help me think about priorities", {
    bridge: { callTool: async (...args) => calls.push(args) },
    config: config(),
    session: new SessionStore(),
    llmClient,
  });

  assert.equal(result.kind, "llm_chat");
  assert.match(result.text, /priority tradeoff/);
  assert.equal(calls.length, 0);
  assert.equal(llmClient.calls.length, 1);
  assert.equal(llmClient.calls[0].format, undefined);
  assert.equal(result._timings.llmRouterSkipped, "direct_chat_intent");
});

test("LLM direct chat fast path does not catch task commands", async () => {
  const llmClient = new FakeLlmClient([
    { mode: "execute", reason: "user asks to view tasks" },
    { command: "today", argsText: "" },
  ]);
  const bridge = {
    async callTool() {
      return { tasks: [{ title: "Visible task", dueBucket: "today" }] };
    },
  };

  const result = await routeText("please show me my tasks", {
    bridge,
    config: config(),
    session: new SessionStore(),
    llmClient,
  });

  assert.equal(result.kind, "bridge");
  assert.equal(result.tool, "ticktick_today");
  assert.equal(result._timings.llmRouterSkipped, undefined);
});

test("LLM direct chat fast path supports Chinese support phrasing", async () => {
  for (const text of [
    "我压力很大，帮我想想优先级",
    "我好攰，幫我諗下優先次序",
  ]) {
    const llmClient = new FakeLlmClient([
      "Let us pick one small next step.",
    ]);
    const calls = [];

    const result = await routeText(text, {
      bridge: { callTool: async (...args) => calls.push(args) },
      config: config(),
      session: new SessionStore(),
      llmClient,
    });

    assert.equal(result.kind, "llm_chat");
    assert.equal(calls.length, 0);
    assert.equal(llmClient.calls.length, 1);
    assert.equal(result._timings.llmRouterSkipped, "direct_chat_intent");
  }
});

test("LLM executor mode routes through existing command router", async () => {
  const llmClient = new FakeLlmClient([
    { mode: "execute", reason: "user asks to view today" },
    { command: "today", argsText: "" },
  ]);
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return { tasks: [{ title: "Visible task", dueBucket: "today" }] };
    },
  };

  const result = await routeText("please inspect my current TickTick queue", {
    bridge,
    config: config(),
    session: new SessionStore(),
    llmClient,
  });

  assert.equal(result.kind, "bridge");
  assert.equal(result.routedBy, "llm_executor");
  assert.equal(result.narratedBy, undefined);
  assert.equal(result.formattedBy, "deterministic_task_list");
  assert.equal(result.tool, "ticktick_today");
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);
  assert.match(result.text, /Visible task/);
  assert.equal(llmClient.calls.length, 2);
});

test("LLM executor keeps deterministic read-only reply when narrator fails", async () => {
  const llmClient = new FakeLlmClient([
    { mode: "execute", reason: "user asks for diagnostics" },
    { command: "diagnostics", argsText: "" },
    new Error("narrator unavailable"),
  ]);
  const bridge = {
    async callTool() {
      return { ok: true, checks: { oauth: true } };
    },
  };

  const result = await routeText("show diagnostics", {
    bridge,
    config: config(),
    session: new SessionStore(),
    llmClient,
  });

  assert.equal(result.kind, "bridge");
  assert.equal(result.routedBy, "llm_executor");
  assert.equal(result.narratedBy, undefined);
  assert.match(result.text, /Diagnostics/);
  assert.equal(result._timings.llmNarratorStatus, "failed");
  assert.equal(typeof result._timings.llmNarratorMs, "number");
  assert.equal(llmClient.calls.length, 3);
});

test("LLM executor formats task lists without narrator and preserves all tasks", async () => {
  const llmClient = new FakeLlmClient([
    { mode: "execute", reason: "user asks to view today" },
    { command: "today", argsText: "" },
  ]);
  const bridge = {
    async callTool() {
      return {
        tasks: [
          { title: "First task", dueBucket: "overdue" },
          { title: "Second task", dueBucket: "overdue" },
        ],
      };
    },
  };

  const result = await routeText("please inspect my current TickTick queue", {
    bridge,
    config: config(),
    session: new SessionStore(),
    llmClient,
  });

  assert.equal(result.kind, "bridge");
  assert.equal(result.routedBy, "llm_executor");
  assert.equal(result.narratedBy, undefined);
  assert.equal(result.formattedBy, "deterministic_task_list");
  assert.match(result.text, /First task/);
  assert.match(result.text, /Second task/);
  assert.doesNotMatch(result.text, /summary:/);
  assert.equal(llmClient.calls.length, 2);
});

test("task list fast formatter localizes Russian and removes raw summary", () => {
  const text = llmAgentInternals.formatTaskListForUser({
    tool: "ticktick_today",
    text: [
      "Today and overdue",
      'summary: {"overdue":2,"today":0}',
      "Overdue",
      "- First task [Inbox] due 2026-06-29T21:00:00.000+0000 priority high",
      "- Second task [Work]",
    ].join("\n"),
  }, "Расскажи мне, какие у меня есть задачи?");

  assert.match(text, /Вот что висит/);
  assert.match(text, /Просрочено/);
  assert.match(text, /First task/);
  assert.match(text, /Second task/);
  assert.match(text, /срок 2026-06-29 21:00/);
  assert.match(text, /высокий приоритет/);
  assert.doesNotMatch(text, /summary:/);
});

test("natural Russian task list intent bypasses LLM and stays human-readable", async () => {
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return {
        summary: { overdue: 1, today: 1 },
        tasks: [
          { title: "Просроченная задача", dueBucket: "overdue", projectName: "Inbox" },
          { title: "Задача на сегодня", dueBucket: "today", projectName: "Work" },
        ],
      };
    },
  };
  const llmClient = {
    async chat() {
      throw new Error("LLM should not be called for deterministic task-list intents");
    },
  };

  const result = await routeText("Расскажи мне, какие у меня есть задачи?", {
    bridge,
    config: config(),
    session: new SessionStore(),
    llmClient,
  });

  assert.equal(result.kind, "bridge");
  assert.equal(result.tool, "ticktick_today");
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);
  assert.match(result.text, /Вот что висит/);
  assert.match(result.text, /Просроченная задача/);
  assert.match(result.text, /Задача на сегодня/);
  assert.doesNotMatch(result.text, /summary:/);
});

test("natural Chinese task list intents bypass LLM and localize headings", async () => {
  const cases = [
    {
      text: "我今天有什么任务？",
      heading: /今天和逾期任务/,
      overdue: /逾期/,
      due: /截止 2026-06-29 21:00/,
      priority: /高优先级/,
    },
    {
      text: "我今日有咩任務？",
      heading: /今日同逾期事項/,
      overdue: /逾期/,
      due: /期限 2026-06-29 21:00/,
      priority: /高優先級/,
    },
  ];

  for (const item of cases) {
    const calls = [];
    const bridge = {
      async callTool(name, args) {
        calls.push({ name, args });
        return {
          summary: { overdue: 1, today: 1 },
          tasks: [
            {
              title: "Visible task",
              dueBucket: "overdue",
              projectName: "Inbox",
              dueDate: "2026-06-29T21:00:00.000+0000",
              priority: 5,
            },
            { title: "Today task", dueBucket: "today", projectName: "Work" },
          ],
        };
      },
    };
    const llmClient = {
      async chat() {
        throw new Error("LLM should not be called for deterministic Chinese task-list intents");
      },
    };

    const result = await routeText(item.text, {
      bridge,
      config: config(),
      session: new SessionStore(),
      llmClient,
    });

    assert.equal(result.kind, "bridge");
    assert.equal(result.tool, "ticktick_today");
    assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);
    assert.match(result.text, item.heading);
    assert.match(result.text, item.overdue);
    assert.match(result.text, /Visible task/);
    assert.match(result.text, /Today task/);
    assert.match(result.text, item.due);
    assert.match(result.text, item.priority);
    assert.doesNotMatch(result.text, /summary:/);
  }
});

test("LLM narrator preservation check extracts task titles from deterministic lines", () => {
  assert.deepEqual(
    llmAgentInternals.listedTaskTitles([
      "Today and overdue",
      "Overdue",
      "- First task [Inbox] due 2026-07-01T12:00:00+0300 priority high",
      "- Second task priority low",
    ].join("\n")),
    ["First task", "Second task"],
  );
});

test("LLM executor writes still create existing confirmation drafts", async () => {
  const llmClient = new FakeLlmClient([
    { mode: "execute", reason: "user asks to create a task" },
    { command: "add", argsText: "call doctor tomorrow 30 min" },
  ]);
  const session = new SessionStore();
  const calls = [];

  const result = await routeText("please add call doctor tomorrow 30 min", {
    bridge: { callTool: async (...args) => calls.push(args) },
    config: config({ TELEGRAM_DEFAULT_PROJECT_ID: "project-1" }),
    session,
    llmClient,
  });

  assert.equal(result.kind, "task_draft");
  assert.match(result.text, /Ready to create/);
  assert.equal(calls.length, 0);
  assert.ok(session.getPendingTaskDraft("local"));
});

test("LLM fail-closed avoids deterministic task draft on unsafe model output", async () => {
  const llmClient = new FakeLlmClient(["not json", "still not json"]);
  const calls = [];

  const result = await routeText("let us talk about whether this day is too heavy", {
    bridge: { callTool: async (...args) => calls.push(args) },
    config: config(),
    session: new SessionStore(),
    llmClient,
  });

  assert.equal(result.kind, "llm_unavailable");
  assert.match(result.text, /LLM mode is unavailable/);
  assert.equal(calls.length, 0);
});

test("LLM executor cannot execute confirm", async () => {
  const llmClient = new FakeLlmClient([
    { mode: "execute", reason: "model tried to confirm" },
    { command: "confirm", argsText: "" },
  ]);
  const calls = [];

  const result = await routeText("yes do it", {
    bridge: { callTool: async (...args) => calls.push(args) },
    config: config(),
    session: new SessionStore(),
    llmClient,
  });

  assert.equal(result.kind, "llm_unavailable");
  assert.equal(calls.length, 0);
});

test("pending deterministic drafts bypass LLM mode", async () => {
  const llmClient = new FakeLlmClient([
    { mode: "chat", reason: "should not be used" },
  ]);
  const session = new SessionStore();
  const bridge = { callTool: async () => { throw new Error("should not call bridge"); } };
  const cfg = config();

  await routeText("/add call doctor", { bridge, config: cfg, session, llmClient });
  const result = await routeText("tomorrow", { bridge, config: cfg, session, llmClient });

  assert.equal(result.kind, "task_draft");
  assert.equal(llmClient.calls.length, 0);
});
