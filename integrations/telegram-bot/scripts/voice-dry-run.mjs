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
  TELEGRAM_VOICE_PROVIDER: "mock",
  TELEGRAM_VOICE_MOCK_TRANSCRIPT: "what is next",
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

const update = {
  update_id: 1,
  message: {
    voice: { file_id: "voice-1", duration: 9, mime_type: "audio/ogg" },
    from: { id: 1001 },
    chat: { id: 1001, type: "private" },
  },
};

const reply = await handleUpdate(update, {
  bridge,
  config,
  rateLimiter: new RateLimiter({ windowMs: 60000, maxCommands: 10 }),
  session: new SessionStore(),
});

console.log(reply.text);
