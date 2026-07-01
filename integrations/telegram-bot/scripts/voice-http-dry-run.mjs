import { loadConfig } from "../src/config.mjs";
import { handleUpdate } from "../src/command-router.mjs";
import { RateLimiter } from "../src/rate-limit.mjs";
import { SessionStore } from "../src/session-store.mjs";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function ticktickDateMinutesFromNow(minutes) {
  const date = new Date(Date.now() + minutes * 60 * 1000);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:00+0000`;
}

const config = loadConfig({
  TELEGRAM_DRY_RUN: "true",
  TELEGRAM_ALLOWED_USER_IDS: "1001",
  TELEGRAM_VOICE_ENABLED: "true",
  TELEGRAM_VOICE_PROVIDER: "http",
  TELEGRAM_VOICE_DOWNLOAD_ENABLED: "true",
  TELEGRAM_VOICE_MAX_BYTES: "10",
  TELEGRAM_VOICE_HTTP_URL: "http://127.0.0.1:9876/transcribe",
  TELEGRAM_VOICE_HTTP_TOKEN: "dummy-token",
});

const requests = [];
const telegramCalls = [];

const bridge = {
  async callTool(name) {
    if (name === "ticktick_today") {
      return {
        tasks: [
          { id: "soon-1", title: "Leave for appointment", dueBucket: "today", dueDate: ticktickDateMinutesFromNow(20), priority: 5 },
        ],
      };
    }
    return { tasks: [] };
  },
};

const update = {
  update_id: 1,
  message: {
    voice: { file_id: "voice-1", duration: 9, mime_type: "audio/ogg", file_size: 3 },
    from: { id: 1001 },
    chat: { id: 1001, type: "private" },
  },
};

const reply = await handleUpdate(update, {
  bridge,
  config,
  telegram: {
    async getFile(fileId) {
      telegramCalls.push(["getFile", fileId]);
      return { file_path: "voice/file.ogg", file_size: 3 };
    },
    async downloadFileBytes(filePath) {
      telegramCalls.push(["downloadFileBytes", filePath]);
      return Uint8Array.from([1, 2, 3]);
    },
  },
  voiceFetchImpl: async (url, request) => {
    requests.push({
      url,
      hasAuthorization: Boolean(request.headers.Authorization),
      body: JSON.parse(request.body),
    });
    return {
      ok: true,
      json: async () => ({ transcript: "what is next" }),
    };
  },
  rateLimiter: new RateLimiter({ windowMs: 60000, maxCommands: 10 }),
  session: new SessionStore(),
});

console.log(reply.text);
console.log("");
console.log(`Telegram downloader calls: ${telegramCalls.length}`);
console.log(`HTTP requests: ${requests.length}`);
console.log(`Authorization header sent: ${requests[0]?.hasAuthorization === true}`);
console.log(`Audio payload bytes encoded: ${requests[0]?.body.audioBase64 === "AQID"}`);
