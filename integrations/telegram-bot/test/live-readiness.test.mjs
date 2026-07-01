import test from "node:test";
import assert from "node:assert/strict";
import { runLiveReadiness } from "../scripts/live-readiness.mjs";

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

function telegramResult(result) {
  return {
    ok: true,
    text: async () => JSON.stringify({ ok: true, result }),
  };
}

function bridgeFetch(calls) {
  return async (_url, request) => {
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
      return rpcResult(body.id, toolResult({ tasks: [] }));
    }
    if (body.method === "tools/call" && body.params.name === "ticktick_inbox") {
      return rpcResult(body.id, toolResult({ tasks: [] }));
    }
    throw new Error(`unexpected bridge call ${body.method} ${body.params?.name || ""}`);
  };
}

function liveEnv() {
  return {
    TELEGRAM_BOT_TOKEN: "123456:secret-telegram-token",
    TELEGRAM_ALLOWED_USER_IDS: "10",
    TICKTICK_MCP_URL: "https://bridge.example.test/mcp",
    TICKTICK_MCP_BEARER_TOKEN: "secret-bridge-token",
    TELEGRAM_VOICE_HTTP_TOKEN: "secret-voice-token",
    TELEGRAM_VOICE_MOCK_TRANSCRIPT: "private transcript",
  };
}

test("live-readiness redacts secrets and calls only Telegram getMe", async () => {
  const bridgeCalls = [];
  const telegramCalls = [];
  const telegramFetchImpl = async (url, request) => {
    telegramCalls.push({ url, request });
    if (!String(url).endsWith("/getMe")) {
      throw new Error(`unexpected Telegram method ${url}`);
    }
    return telegramResult({ id: 123456, is_bot: true, username: "ticktick_test_bot" });
  };

  const result = await runLiveReadiness({
    env: liveEnv(),
    envFilePath: ".missing-test-env",
    bridgeFetchImpl: bridgeFetch(bridgeCalls),
    telegramFetchImpl,
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /telegramToken: set/);
  assert.match(result.text, /bridgeBearerToken: set/);
  assert.match(result.text, /Telegram getMe/);
  assert.match(result.text, /ok: true/);
  assert.doesNotMatch(result.text, /secret-telegram-token/);
  assert.doesNotMatch(result.text, /secret-bridge-token/);
  assert.doesNotMatch(result.text, /secret-voice-token/);
  assert.doesNotMatch(result.text, /private transcript/);
  assert.equal(telegramCalls.length, 1);
  assert.match(telegramCalls[0].url, /\/getMe$/);
  assert.doesNotMatch(telegramCalls[0].url, /getUpdates|sendMessage/);
  assert.equal(telegramCalls[0].request.method, "POST");
  assert.equal(telegramCalls[0].request.body, "{}");
  assert.deepEqual(bridgeCalls.filter((call) => call.method === "tools/call").map((call) => call.params.name), [
    "ticktick_diagnostics",
    "ticktick_today",
    "ticktick_inbox",
  ]);
});

test("live-readiness fails closed without live Telegram token or allowlist but still checks bridge", async () => {
  const bridgeCalls = [];
  const telegramCalls = [];

  const result = await runLiveReadiness({
    env: { TICKTICK_MCP_URL: "https://bridge.example.test/mcp" },
    envFilePath: ".missing-test-env",
    bridgeFetchImpl: bridgeFetch(bridgeCalls),
    telegramFetchImpl: async (...args) => {
      telegramCalls.push(args);
      throw new Error("Telegram should not be called");
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.text, /TELEGRAM_BOT_TOKEN is required/);
  assert.match(result.text, /TELEGRAM_ALLOWED_USER_IDS is required/);
  assert.match(result.text, /Bridge read-only smoke/);
  assert.match(result.text, /Telegram getMe/);
  assert.match(result.text, /skipped: true/);
  assert.match(result.text, /Live-readiness preflight failed closed/);
  assert.equal(telegramCalls.length, 0);
  assert.deepEqual(bridgeCalls.map((call) => call.method).slice(0, 2), ["initialize", "tools/list"]);
});

test("live-readiness dry-run mode does not require Telegram token", async () => {
  const bridgeCalls = [];
  const telegramCalls = [];

  const result = await runLiveReadiness({
    env: {
      TELEGRAM_DRY_RUN: "true",
      TICKTICK_MCP_URL: "https://bridge.example.test/mcp",
    },
    envFilePath: ".missing-test-env",
    bridgeFetchImpl: bridgeFetch(bridgeCalls),
    telegramFetchImpl: async (...args) => {
      telegramCalls.push(args);
      throw new Error("Telegram should not be called");
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /Valid for dry-run checks/);
  assert.match(result.text, /Dry-run mode is enabled/);
  assert.match(result.text, /Live-readiness preflight passed/);
  assert.equal(telegramCalls.length, 0);
  assert.equal(bridgeCalls.some((call) => call.method === "tools/call"), true);
});
