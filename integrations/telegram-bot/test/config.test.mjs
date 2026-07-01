import test from "node:test";
import assert from "node:assert/strict";
import { ConfigError, assertValidConfig, loadConfig, parseEnvFile, parseList, parseProjectRoutes, parseQuietHours } from "../src/config.mjs";
import { buildConfigSummary } from "../scripts/config-check.mjs";

test("parseList trims comma-separated values", () => {
  assert.deepEqual(parseList(" 1, 2,,3 "), ["1", "2", "3"]);
});

test("parseQuietHours supports overnight windows", () => {
  assert.deepEqual(parseQuietHours("22-7"), { startHour: 22, endHour: 7 });
});

test("parseEnvFile reads simple dotenv files without dependencies", () => {
  assert.deepEqual(parseEnvFile("A=1\n# comment\nB=\"two words\"\nC='three'\n"), {
    A: "1",
    B: "two words",
    C: "three",
  });
});

test("parseProjectRoutes reads keyword to project mappings", () => {
  assert.deepEqual(parseProjectRoutes("doctor=project-health|Health; work:project-work"), [
    { keyword: "doctor", projectId: "project-health", projectName: "Health" },
    { keyword: "work", projectId: "project-work", projectName: "" },
  ]);
});

test("live config fails closed without token and allowlist", () => {
  const config = loadConfig({});
  assert.throws(() => assertValidConfig(config), ConfigError);
  assert.match(config.errors.join("\n"), /TELEGRAM_BOT_TOKEN/);
  assert.match(config.errors.join("\n"), /TELEGRAM_ALLOWED_USER_IDS/);
});

test("dry-run config does not require secrets", () => {
  const config = loadConfig({ TELEGRAM_DRY_RUN: "true" });
  assert.equal(config.errors.length, 0);
  assert.equal(config.bridge.url, "http://127.0.0.1:8787/mcp");
  assert.equal(config.llm.enabled, false);
  assert.equal(config.llm.model, "qwen3:14b");
  assert.deepEqual(config.telegram.checkinHours, { startHour: 9, endHour: 21 });
  assert.equal(config.telegram.confirmWrites, false);
});

test("allowed user ids and limits are parsed", () => {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_ALLOWED_USER_IDS: "10, 20",
    TELEGRAM_MAX_RESULTS: "5",
  });
  assert.equal(config.errors.length, 0);
  assert.equal(config.telegram.allowedUserIds.has("10"), true);
  assert.equal(config.telegram.maxResults, 5);
  assert.equal(config.telegram.proactiveEnabled, false);
});

test("config summary redacts secret values", () => {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: "secret-telegram-token",
    TELEGRAM_ALLOWED_USER_IDS: "10",
    TICKTICK_MCP_BEARER_TOKEN: "secret-bridge-token",
    TELEGRAM_VOICE_MOCK_TRANSCRIPT: "private voice transcript",
    TELEGRAM_VOICE_HTTP_URL: "http://127.0.0.1:9876/private",
    TELEGRAM_VOICE_HTTP_TOKEN: "secret-voice-token",
  });
  const summary = buildConfigSummary(config);

  assert.match(summary, /telegramToken: set/);
  assert.match(summary, /bridgeBearerToken: set/);
  assert.match(summary, /voiceMockTranscript: set/);
  assert.match(summary, /voiceHttpUrl: set/);
  assert.match(summary, /voiceHttpToken: set/);
  assert.doesNotMatch(summary, /secret-telegram-token/);
  assert.doesNotMatch(summary, /secret-bridge-token/);
  assert.doesNotMatch(summary, /private voice transcript/);
  assert.doesNotMatch(summary, /secret-voice-token/);
  assert.doesNotMatch(summary, /9876\/private/);
});

test("LLM config is explicit and redacted in summaries", () => {
  const config = loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_LLM_ENABLED: "true",
    TELEGRAM_LLM_MODEL: "qwen3:14b",
    TELEGRAM_LLM_OLLAMA_URL: "http://127.0.0.1:11434/private",
  });
  const summary = buildConfigSummary(config);

  assert.equal(config.errors.length, 0);
  assert.equal(config.llm.enabled, true);
  assert.equal(config.llm.routerModel, "qwen3:14b");
  assert.match(summary, /llmEnabled: true/);
  assert.match(summary, /llmModel: qwen3:14b/);
  assert.doesNotMatch(summary, /11434\/private/);
});

test("unsupported LLM provider fails closed when LLM is enabled", () => {
  const config = loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_LLM_ENABLED: "true",
    TELEGRAM_LLM_PROVIDER: "unknown",
  });

  assert.match(config.errors.join("\n"), /Unsupported TELEGRAM_LLM_PROVIDER/);
});

test("OpenAI LLM provider requires explicit key and model", () => {
  const config = loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_LLM_ENABLED: "true",
    TELEGRAM_LLM_PROVIDER: "openai",
  });

  assert.match(config.errors.join("\n"), /OPENAI_API_KEY/);
  assert.match(config.errors.join("\n"), /OPENAI_MODEL/);
});

test("OpenAI LLM provider redacts API key in summaries", () => {
  const config = loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_LLM_ENABLED: "true",
    TELEGRAM_LLM_PROVIDER: "openai",
    TELEGRAM_LLM_OPENAI_API_KEY: "secret-openai-key",
    TELEGRAM_LLM_OPENAI_MODEL: "openai-test-model",
  });
  const summary = buildConfigSummary(config);

  assert.equal(config.errors.length, 0);
  assert.equal(config.llm.provider, "openai");
  assert.equal(config.llm.model, "openai-test-model");
  assert.match(summary, /llmOpenAiApiKey: set/);
  assert.match(summary, /llmModel: openai-test-model/);
  assert.doesNotMatch(summary, /secret-openai-key/);
});
