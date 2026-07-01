import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { runBridgeReadOnlySmoke } from "../scripts/bridge-readonly-smoke.mjs";

const REQUIRED_TOOLS = [
  "ticktick_diagnostics",
  "ticktick_today",
  "ticktick_inbox",
  "ticktick_search_tasks",
];

function rpcResult(id, result) {
  return {
    ok: true,
    text: async () => JSON.stringify({ jsonrpc: "2.0", id, result }),
  };
}

function toolResult(data) {
  return {
    content: [
      { type: "text", text: JSON.stringify(data) },
    ],
  };
}

function config() {
  return loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: "10",
    TICKTICK_MCP_URL: "https://bridge.example.test/mcp",
    TICKTICK_MCP_BEARER_TOKEN: "secret-token",
  });
}

test("bridge read-only smoke calls only safe MCP tools", async () => {
  const calls = [];
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push(body);
    if (body.method === "initialize") return rpcResult(body.id, { protocolVersion: "2025-03-26" });
    if (body.method === "tools/list") {
      return rpcResult(body.id, {
        tools: REQUIRED_TOOLS.map((name) => ({ name })),
      });
    }
    if (body.method === "tools/call" && body.params.name === "ticktick_diagnostics") {
      return rpcResult(body.id, toolResult({ ok: true, checks: { auth_configured: true, inbox_endpoint: true } }));
    }
    if (body.method === "tools/call" && body.params.name === "ticktick_today") {
      return rpcResult(body.id, toolResult({ tasks: [{ title: "Today" }] }));
    }
    if (body.method === "tools/call" && body.params.name === "ticktick_inbox") {
      return rpcResult(body.id, toolResult([{ title: "Inbox" }]));
    }
    if (body.method === "tools/call" && body.params.name === "ticktick_search_tasks") {
      return rpcResult(body.id, toolResult({ tasks: [{ title: "Search result" }] }));
    }
    throw new Error(`unexpected call ${body.method} ${body.params?.name || ""}`);
  };

  const result = await runBridgeReadOnlySmoke({
    config: config(),
    searchQuery: "doctor",
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /initialize: ok/);
  assert.match(result.text, /requiredTools: ok/);
  assert.match(result.text, /diagnostics.ok: true/);
  assert.match(result.text, /todayTasks: 1/);
  assert.match(result.text, /inboxTasks: 1/);
  assert.match(result.text, /searchTasks: 1/);
  assert.match(result.text, /writesCalled: false/);
  assert.doesNotMatch(result.text, /secret-token/);
  assert.deepEqual(calls.filter((call) => call.method === "tools/call").map((call) => call.params.name), [
    "ticktick_diagnostics",
    "ticktick_today",
    "ticktick_inbox",
    "ticktick_search_tasks",
  ]);
});

test("bridge read-only smoke fails closed when required tools are missing", async () => {
  const calls = [];
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body);
    calls.push(body);
    if (body.method === "initialize") return rpcResult(body.id, {});
    if (body.method === "tools/list") {
      return rpcResult(body.id, { tools: [{ name: "ticktick_diagnostics" }] });
    }
    throw new Error(`unexpected call ${body.method}`);
  };

  const result = await runBridgeReadOnlySmoke({
    config: config(),
    fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.match(result.text, /requiredTools: missing/);
  assert.deepEqual(calls.map((call) => call.method), ["initialize", "tools/list"]);
});
