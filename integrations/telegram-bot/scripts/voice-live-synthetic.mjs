import fs from "node:fs";
import path from "node:path";
import { McpBridgeClient } from "../src/bridge-client.mjs";
import { loadConfig, loadEnvWithFile, assertValidConfig } from "../src/config.mjs";
import { createLlmClient } from "../src/llm-client.mjs";
import { handleUpdate } from "../src/command-router.mjs";
import { SessionStore } from "../src/session-store.mjs";
import { RateLimiter } from "../src/rate-limit.mjs";

function firstSetValue(set, fallback = "") {
  return [...(set || [])][0] || fallback;
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".webm") return "audio/webm";
  return "application/octet-stream";
}

const audioPath = process.env.TELEGRAM_SYNTHETIC_VOICE_AUDIO_PATH || process.argv[2] || "";
if (!audioPath) {
  console.error("Set TELEGRAM_SYNTHETIC_VOICE_AUDIO_PATH or pass an audio file path.");
  process.exit(2);
}

const audio = fs.readFileSync(audioPath);
const config = assertValidConfig(loadConfig(loadEnvWithFile(process.env)));
const bridge = new McpBridgeClient(config.bridge);
await bridge.initialize();
const llmClient = createLlmClient(config.llm);
const userId = String(process.env.TELEGRAM_SYNTHETIC_USER_ID || firstSetValue(config.telegram.allowedUserIds, "1001"));
const chatId = String(process.env.TELEGRAM_SYNTHETIC_CHAT_ID || firstSetValue(config.telegram.allowedChatIds, userId));
const duration = Number(process.env.TELEGRAM_SYNTHETIC_VOICE_DURATION || 3);
const logs = [];

const update = {
  update_id: Number(process.env.TELEGRAM_SYNTHETIC_UPDATE_ID || Date.now()),
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    from: { id: userId, is_bot: false },
    chat: { id: chatId, type: "private" },
    voice: {
      file_id: "synthetic-voice",
      duration,
      mime_type: mimeFromPath(audioPath),
      file_size: audio.byteLength,
    },
  },
};

const reply = await handleUpdate(update, {
  bridge,
  config,
  llmClient,
  rateLimiter: new RateLimiter({
    windowMs: config.operational.rateLimitWindowMs,
    maxCommands: config.operational.rateLimitMaxCommands,
  }),
  session: new SessionStore(),
  telegram: {
    async getFile(fileId) {
      return { file_path: `${fileId}${path.extname(audioPath)}`, file_size: audio.byteLength };
    },
    async downloadFileBytes() {
      return audio;
    },
  },
  logger: { info: (line) => logs.push(line) },
});

const timingEvents = logs.map((line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}).filter((event) => event?.event === "telegram_voice_pipeline_timing");

console.log(JSON.stringify({
  ok: true,
  replyKind: reply.kind,
  authorized: reply.authorized,
  replyTextLength: String(reply.text || "").length,
  timingEvents,
}, null, 2));
