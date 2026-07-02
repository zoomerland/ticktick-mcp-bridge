import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import {
  downloadVoiceAudio,
  getVoiceMessage,
  isLowSignalVoiceTranscript,
  transcribeVoiceMessage,
} from "../src/secretary/voice.mjs";

test("getVoiceMessage extracts safe metadata only", () => {
  const voice = getVoiceMessage({
    message: {
      voice: {
        file_id: "voice-1",
        duration: 12,
        mime_type: "audio/ogg",
        file_size: 1024,
      },
    },
  });

  assert.deepEqual(voice, {
    fileId: "voice-1",
    duration: 12,
    mimeType: "audio/ogg",
    fileSize: 1024,
  });
});

test("low-signal voice transcript guard allows short Chinese commands", () => {
  assert.equal(isLowSignalVoiceTranscript("on."), true);
  assert.equal(isLowSignalVoiceTranscript("今天"), false);
  assert.equal(isLowSignalVoiceTranscript("今日"), false);
  assert.equal(isLowSignalVoiceTranscript("任务"), false);
  assert.equal(isLowSignalVoiceTranscript("任務"), false);
});

test("transcribeVoiceMessage fails closed when disabled", async () => {
  const result = await transcribeVoiceMessage({
    voice: { fileId: "voice-1", duration: 12 },
    config: loadConfig({ TELEGRAM_DRY_RUN: "true" }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "disabled");
  assert.match(result.text, /not enabled/);
});

test("transcribeVoiceMessage mock provider needs an explicit transcript", async () => {
  const result = await transcribeVoiceMessage({
    voice: { fileId: "voice-1", duration: 12 },
    config: loadConfig({
      TELEGRAM_DRY_RUN: "true",
      TELEGRAM_VOICE_ENABLED: "true",
      TELEGRAM_VOICE_PROVIDER: "mock",
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_mock_transcript");
  assert.match(result.text, /TELEGRAM_VOICE_MOCK_TRANSCRIPT/);
});

test("transcribeVoiceMessage mock provider returns configured transcript", async () => {
  const result = await transcribeVoiceMessage({
    voice: { fileId: "voice-1", duration: 12 },
    config: loadConfig({
      TELEGRAM_DRY_RUN: "true",
      TELEGRAM_VOICE_ENABLED: "true",
      TELEGRAM_VOICE_PROVIDER: "mock",
      TELEGRAM_VOICE_MOCK_TRANSCRIPT: "what is next",
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "mock");
  assert.equal(result.transcript, "what is next");
  assert.doesNotMatch(result.text, /what is next/);
});

test("transcribeVoiceMessage http provider fails closed without audio payload", async () => {
  const requests = [];
  const result = await transcribeVoiceMessage({
    voice: { fileId: "voice-1", duration: 12 },
    config: loadConfig({
      TELEGRAM_DRY_RUN: "true",
      TELEGRAM_VOICE_ENABLED: "true",
      TELEGRAM_VOICE_PROVIDER: "http",
      TELEGRAM_VOICE_HTTP_URL: "http://127.0.0.1:9876/transcribe",
    }),
    fetchImpl: async (...args) => requests.push(args),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "voice_download_disabled");
  assert.match(result.text, /download is disabled/);
  assert.equal(requests.length, 0);
});

test("transcribeVoiceMessage http provider posts explicit audio payload", async () => {
  const requests = [];
  const result = await transcribeVoiceMessage({
    voice: { fileId: "voice-1", duration: 12, mimeType: "audio/ogg", fileSize: 3 },
    audio: { bytes: Uint8Array.from([1, 2, 3]), mimeType: "audio/ogg" },
    config: loadConfig({
      TELEGRAM_DRY_RUN: "true",
      TELEGRAM_VOICE_ENABLED: "true",
      TELEGRAM_VOICE_PROVIDER: "http",
      TELEGRAM_VOICE_HTTP_URL: "http://127.0.0.1:9876/transcribe",
      TELEGRAM_VOICE_HTTP_TOKEN: "test-http-token",
    }),
    fetchImpl: async (url, request) => {
      requests.push({ url, request });
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
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "sensevoice_resident");
  assert.equal(result.transcript, "what is next");
  assert.equal(result.audioBytes, 3);
  assert.equal(result.sttElapsedMs, 321);
  assert.equal(result.sttRequestElapsedMs, 456);
  assert.equal(result.timings.sttProviderElapsedMs, 321);
  assert.equal(result.timings.sttRequestElapsedMs, 456);
  assert.equal(Number.isInteger(result.timings.sttHttpMs), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:9876/transcribe");
  assert.equal(requests[0].request.headers.Authorization, ["Bearer", "test-http-token"].join(" "));
  assert.deepEqual(JSON.parse(requests[0].request.body), {
    audioBase64: "AQID",
    mimeType: "audio/ogg",
    duration: 12,
    fileSize: 3,
  });
});

test("downloadVoiceAudio fails closed when download is disabled", async () => {
  const result = await downloadVoiceAudio({
    voice: { fileId: "voice-1", fileSize: 3 },
    config: loadConfig({ TELEGRAM_DRY_RUN: "true" }),
    telegram: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "voice_download_disabled");
});

test("downloadVoiceAudio enforces size limit before download", async () => {
  const result = await downloadVoiceAudio({
    voice: { fileId: "voice-1", fileSize: 1024 },
    config: loadConfig({
      TELEGRAM_DRY_RUN: "true",
      TELEGRAM_VOICE_DOWNLOAD_ENABLED: "true",
      TELEGRAM_VOICE_MAX_BYTES: "10",
    }),
    telegram: {
      getFile: async () => { throw new Error("should not call getFile"); },
      downloadFileBytes: async () => { throw new Error("should not download"); },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "voice_file_too_large");
});

test("downloadVoiceAudio downloads small files into memory only", async () => {
  const calls = [];
  const result = await downloadVoiceAudio({
    voice: { fileId: "voice-1", fileSize: 3, mimeType: "audio/ogg" },
    config: loadConfig({
      TELEGRAM_DRY_RUN: "true",
      TELEGRAM_VOICE_DOWNLOAD_ENABLED: "true",
      TELEGRAM_VOICE_MAX_BYTES: "10",
    }),
    telegram: {
      async getFile(fileId) {
        calls.push(["getFile", fileId]);
        return { file_path: "voice/file.ogg", file_size: 3 };
      },
      async downloadFileBytes(filePath) {
        calls.push(["downloadFileBytes", filePath]);
        return Uint8Array.from([1, 2, 3]);
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual([...result.audio.bytes], [1, 2, 3]);
  assert.equal(result.audio.mimeType, "audio/ogg");
  assert.equal(result.timings.audioBytes, 3);
  assert.equal(Number.isInteger(result.timings.telegramGetFileMs), true);
  assert.equal(Number.isInteger(result.timings.telegramDownloadFileMs), true);
  assert.equal(Number.isInteger(result.timings.voiceDownloadMs), true);
  assert.deepEqual(calls, [["getFile", "voice-1"], ["downloadFileBytes", "voice/file.ogg"]]);
});
