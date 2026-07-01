import test from "node:test";
import assert from "node:assert/strict";
import { createLlmClient, OpenAIChatClient } from "../src/llm-client.mjs";

test("createLlmClient returns null when disabled", () => {
  assert.equal(createLlmClient({ enabled: false }), null);
});

test("OpenAIChatClient sends JSON-mode chat completions without storing data", async () => {
  const requests = [];
  const client = new OpenAIChatClient({
    apiKey: "sk-test",
    model: "test-model",
    timeoutMs: 1000,
    fetchImpl: async (url, request) => {
      requests.push({ url, request });
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "{\"mode\":\"execute\"}" } }],
        }),
      };
    },
  });

  const result = await client.chat({
    format: "json",
    messages: [{ role: "user", content: "Return JSON" }],
    options: { temperature: 0, top_p: 0.9, num_predict: 128 },
  });

  assert.equal(result.content, "{\"mode\":\"execute\"}");
  assert.equal(requests[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(requests[0].request.headers.Authorization, "Bearer sk-test");
  const body = JSON.parse(requests[0].request.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.store, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_completion_tokens, 128);
});

test("OpenAIChatClient requires an API key", async () => {
  const client = new OpenAIChatClient({ model: "test-model" });

  await assert.rejects(
    () => client.chat({ messages: [{ role: "user", content: "hello" }] }),
    /API key is required/,
  );
});
