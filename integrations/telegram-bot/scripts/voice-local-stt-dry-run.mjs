import { createServer } from "../../local-stt-service/src/server.mjs";
import { loadConfig as loadSttConfig } from "../../local-stt-service/src/config.mjs";
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

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

const sttServer = createServer(loadSttConfig({
  STT_PROVIDER: "mock",
  STT_MOCK_TRANSCRIPT: "what is next",
  STT_BEARER_TOKEN: "dummy-token",
  STT_MAX_AUDIO_BYTES: "1024",
}));

const port = await listen(sttServer);

try {
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  if (!health.ok) throw new Error("local STT health check failed");

  const config = loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: "1001",
    TELEGRAM_VOICE_ENABLED: "true",
    TELEGRAM_VOICE_PROVIDER: "http",
    TELEGRAM_VOICE_DOWNLOAD_ENABLED: "true",
    TELEGRAM_VOICE_MAX_BYTES: "1024",
    TELEGRAM_VOICE_HTTP_URL: `http://127.0.0.1:${port}/transcribe`,
    TELEGRAM_VOICE_HTTP_TOKEN: "dummy-token",
  });

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

  const telegramCalls = [];
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
    rateLimiter: new RateLimiter({ windowMs: 60000, maxCommands: 10 }),
    session: new SessionStore(),
  });

  console.log(reply.text);
  console.log("");
  console.log(`Local STT health: ${health.ok}`);
  console.log(`Telegram downloader calls: ${telegramCalls.length}`);
  console.log("HTTP STT server handled transcript: true");
} finally {
  await new Promise((resolve) => sttServer.close(resolve));
}
