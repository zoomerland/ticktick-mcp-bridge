import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { TelegramClient, pollOnce } from "../src/telegram-client.mjs";

test("pollOnce advances offset when update handling fails", async () => {
  const sent = [];
  const errors = [];
  const telegram = {
    async getUpdates() {
      return [
        {
          update_id: 41,
          message: {
            text: "/diagnostics",
            from: { id: 10 },
            chat: { id: 10, type: "private" },
          },
        },
      ];
    },
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
    },
  };
  const bridge = {
    async callTool() {
      throw new Error("bridge unavailable");
    },
  };
  const config = loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: "10",
  });

  const nextOffset = await pollOnce({
    telegram,
    bridge,
    config,
    logger: { error: (message) => errors.push(message) },
    offset: 0,
  });

  assert.equal(nextOffset, 42);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, 10);
  assert.match(sent[0].text, /Command failed/);
  assert.doesNotMatch(sent[0].text, /bridge unavailable/);
  assert.match(errors[0], /bridge unavailable/);
});

test("TelegramClient includes getUpdates limit when provided", async () => {
  const requests = [];
  const client = new TelegramClient({
    token: "token-1",
    fetchImpl: async (url, request = {}) => {
      requests.push({ url, request });
      return {
        ok: true,
        json: async () => ({ ok: true, result: [] }),
      };
    },
  });

  await client.getUpdates({ offset: 100, timeout: 1, limit: 3 });

  assert.equal(requests[0].url, "https://api.telegram.org/bottoken-1/getUpdates");
  assert.deepEqual(JSON.parse(requests[0].request.body), {
    offset: 100,
    limit: 3,
    timeout: 1,
    allowed_updates: ["message", "edited_message"],
  });
});

test("TelegramClient downloads file bytes through Telegram file API", async () => {
  const requests = [];
  const client = new TelegramClient({
    token: "token-1",
    fetchImpl: async (url, request = {}) => {
      requests.push({ url, request });
      if (url.endsWith("/getFile")) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { file_path: "voice/file.ogg", file_size: 3 } }),
        };
      }
      if (url === "https://api.telegram.org/file/bottoken-1/voice/file.ogg") {
        return {
          ok: true,
          arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
        };
      }
      throw new Error(`unexpected url ${url}`);
    },
  });

  const file = await client.getFile("voice-1");
  const bytes = await client.downloadFileBytes(file.file_path);

  assert.deepEqual(file, { file_path: "voice/file.ogg", file_size: 3 });
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(requests[0].url, "https://api.telegram.org/bottoken-1/getFile");
  assert.equal(JSON.parse(requests[0].request.body).file_id, "voice-1");
});

test("TelegramClient rejects oversized downloads before reading known-large bodies", async () => {
  let bodyRead = false;
  const client = new TelegramClient({
    token: "token-1",
    fetchImpl: async () => ({
      ok: true,
      headers: { get: (name) => (name === "content-length" ? "11" : "") },
      arrayBuffer: async () => {
        bodyRead = true;
        return Uint8Array.from([1, 2, 3]).buffer;
      },
    }),
  });

  await assert.rejects(
    () => client.downloadFileBytes("voice/file.ogg", { maxBytes: 10 }),
    /too large/,
  );
  assert.equal(bodyRead, false);
});
