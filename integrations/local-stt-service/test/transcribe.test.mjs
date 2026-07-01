import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { transcribePayload } from "../src/transcribe.mjs";

async function withHelperScript(source, callback) {
  const dir = await mkdtemp(join(tmpdir(), "local-stt-test-"));
  const scriptPath = join(dir, "helper.mjs");
  await writeFile(scriptPath, source, "utf8");
  try {
    return await callback(scriptPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("mock provider returns configured transcript", async () => {
  const result = await transcribePayload({
    audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
    mimeType: "audio/ogg",
  }, loadConfig({
    STT_PROVIDER: "mock",
    STT_MOCK_TRANSCRIPT: "what is next",
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.text, "what is next");
  assert.equal(result.body.audioBytes, 3);
});

test("mock provider fails closed without transcript", async () => {
  const result = await transcribePayload({
    audioBase64: Buffer.from([1]).toString("base64"),
  }, loadConfig({ STT_PROVIDER: "mock" }));

  assert.equal(result.status, 501);
  assert.equal(result.body.error, "mock_transcript_missing");
});

test("audio size limit is enforced", async () => {
  const result = await transcribePayload({
    audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
  }, loadConfig({
    STT_PROVIDER: "mock",
    STT_MOCK_TRANSCRIPT: "what is next",
    STT_MAX_AUDIO_BYTES: "2",
  }));

  assert.equal(result.status, 413);
  assert.equal(result.body.error, "audio_too_large");
});

test("command provider requires command configuration", () => {
  assert.throws(
    () => loadConfig({ STT_PROVIDER: "command" }),
    /STT_COMMAND is required/,
  );
});

test("command provider requires audio placeholder", () => {
  assert.throws(
    () => loadConfig({
      STT_PROVIDER: "command",
      STT_COMMAND: process.execPath,
      STT_COMMAND_ARGS: JSON.stringify(["--version"]),
    }),
    /\{audio\}/,
  );
});

test("command provider parses JSON transcript output", async () => {
  await withHelperScript(`
import { readFileSync } from "node:fs";
const audio = readFileSync(process.argv[2]);
process.stdout.write(JSON.stringify({ text: \`bytes:\${audio.byteLength}\` }));
`, async (scriptPath) => {
    const result = await transcribePayload({
      audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
      mimeType: "audio/ogg",
    }, loadConfig({
      STT_PROVIDER: "command",
      STT_COMMAND: process.execPath,
      STT_COMMAND_ARGS: JSON.stringify([scriptPath, "{audio}"]),
      STT_COMMAND_TIMEOUT_MS: "5000",
    }));

    assert.equal(result.status, 200);
    assert.equal(result.body.text, "bytes:4");
    assert.equal(result.body.provider, "command");
    assert.equal(result.body.audioBytes, 4);
  });
});

test("command provider falls back to plain text stdout", async () => {
  await withHelperScript(`
process.stdout.write("synthetic transcript\\n");
`, async (scriptPath) => {
    const result = await transcribePayload({
      audioBase64: Buffer.from([1]).toString("base64"),
    }, loadConfig({
      STT_PROVIDER: "command",
      STT_COMMAND: process.execPath,
      STT_COMMAND_ARGS: JSON.stringify([scriptPath, "{audio}"]),
    }));

    assert.equal(result.status, 200);
    assert.equal(result.body.text, "synthetic transcript");
  });
});

test("command provider times out", async () => {
  await withHelperScript(`
setTimeout(() => {}, 10_000);
`, async (scriptPath) => {
    const result = await transcribePayload({
      audioBase64: Buffer.from([1]).toString("base64"),
    }, loadConfig({
      STT_PROVIDER: "command",
      STT_COMMAND: process.execPath,
      STT_COMMAND_ARGS: JSON.stringify([scriptPath, "{audio}"]),
      STT_COMMAND_TIMEOUT_MS: "50",
    }));

    assert.equal(result.status, 504);
    assert.equal(result.body.error, "stt_command_timeout");
  });
});
