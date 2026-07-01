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
    { mode: "chat", reason: "user wants discussion" },
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
  assert.equal(llmClient.calls.length, 2);
  assert.equal(llmClient.calls[0].format, "json");
  assert.equal(llmClient.calls[1].format, undefined);
});

test("LLM executor mode routes through existing command router", async () => {
  const llmClient = new FakeLlmClient([
    { mode: "execute", reason: "user asks to view today" },
    { command: "today", argsText: "" },
    { text: "У тебя сегодня одна видимая задача: Visible task." },
  ]);
  const calls = [];
  const bridge = {
    async callTool(name, args) {
      calls.push({ name, args });
      return { tasks: [{ title: "Visible task", dueBucket: "today" }] };
    },
  };

  const result = await routeText("show me today's tasks", {
    bridge,
    config: config(),
    session: new SessionStore(),
    llmClient,
  });

  assert.equal(result.kind, "bridge");
  assert.equal(result.routedBy, "llm_executor");
  assert.equal(result.narratedBy, "llm_narrator");
  assert.equal(result.tool, "ticktick_today");
  assert.deepEqual(calls.map((call) => call.name), ["ticktick_today"]);
  assert.match(result.text, /одна видимая задача/);
  assert.equal(llmClient.calls.length, 3);
  assert.match(llmClient.calls[2].messages[1].content, /Deterministic reply/);
  assert.match(llmClient.calls[2].messages[1].content, /Visible task/);
});

test("LLM executor keeps deterministic read-only reply when narrator fails", async () => {
  const llmClient = new FakeLlmClient([
    { mode: "execute", reason: "user asks to view today" },
    { command: "today", argsText: "" },
    new Error("narrator unavailable"),
  ]);
  const bridge = {
    async callTool() {
      return { tasks: [{ title: "Visible task", dueBucket: "today" }] };
    },
  };

  const result = await routeText("show me today's tasks", {
    bridge,
    config: config(),
    session: new SessionStore(),
    llmClient,
  });

  assert.equal(result.kind, "bridge");
  assert.equal(result.routedBy, "llm_executor");
  assert.equal(result.narratedBy, undefined);
  assert.match(result.text, /Visible task/);
  assert.equal(llmClient.calls.length, 3);
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
