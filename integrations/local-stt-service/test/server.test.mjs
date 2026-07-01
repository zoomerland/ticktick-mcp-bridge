import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { createServer } from "../src/server.mjs";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

test("server exposes health and transcribe endpoints", async () => {
  const server = createServer(loadConfig({
    STT_PROVIDER: "mock",
    STT_MOCK_TRANSCRIPT: "what is next",
  }));
  const port = await listen(server);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const transcription = await fetch(`http://127.0.0.1:${port}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
        mimeType: "audio/ogg",
      }),
    });
    const body = await transcription.json();
    assert.equal(transcription.status, 200);
    assert.equal(body.text, "what is next");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("transcribe endpoint requires bearer token when configured", async () => {
  const server = createServer(loadConfig({
    STT_PROVIDER: "mock",
    STT_MOCK_TRANSCRIPT: "what is next",
    STT_BEARER_TOKEN: "secret-token",
  }));
  const port = await listen(server);
  try {
    const payload = JSON.stringify({
      audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
      mimeType: "audio/ogg",
    });
    const unauthorized = await fetch(`http://127.0.0.1:${port}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`http://127.0.0.1:${port}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-token",
      },
      body: payload,
    });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).text, "what is next");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
