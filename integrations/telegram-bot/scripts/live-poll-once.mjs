import { pathToFileURL } from "node:url";
import { createRuntime, runStartupDiagnostics } from "../src/index.mjs";
import { handleUpdate } from "../src/command-router.mjs";

function commandLabel(update) {
  const text = String(update.message?.text || update.edited_message?.text || "");
  if (text.startsWith("/")) return text.split(/\s+/)[0];
  if (update.message?.voice) return "voice";
  return text ? "text" : "other";
}

function safeRuntimeEnv(env) {
  const allowWrites = env.LIVE_POLL_ONCE_ALLOW_WRITES === "true" && env.TELEGRAM_CONFIRM_WRITES === "true";
  return {
    ...env,
    TELEGRAM_DRY_RUN: "false",
    TELEGRAM_CONFIRM_WRITES: allowWrites ? "true" : "false",
    TELEGRAM_PROACTIVE_ENABLED: "false",
    TELEGRAM_CHECKIN_ENABLED: "false",
    TELEGRAM_REMINDERS_ENABLED: "false",
    TELEGRAM_VOICE_ENABLED: env.TELEGRAM_VOICE_ENABLED || "false",
  };
}

function boundedLimit(env) {
  const parsed = Number.parseInt(env.LIVE_POLL_ONCE_LIMIT || "", 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(parsed, 10));
}

export async function runLivePollOnce({ env = process.env } = {}) {
  const runtime = await createRuntime(safeRuntimeEnv(env));
  const { telegram, bridge, config, rateLimiter, session, logger } = runtime;
  await runStartupDiagnostics(runtime);

  const timeout = Number.parseInt(env.LIVE_POLL_ONCE_TIMEOUT_SECONDS || "", 10);
  const updates = await telegram.getUpdates({
    offset: 0,
    limit: boundedLimit(env),
    timeout: Number.isFinite(timeout) ? timeout : Math.min(config.telegram.pollingTimeoutSeconds, 20),
  });
  let nextOffset = 0;
  const summary = [];

  for (const update of updates) {
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    try {
      const reply = await handleUpdate(update, { bridge, config, rateLimiter, session, telegram });
      if (reply.chatId) await telegram.sendMessage(reply.chatId, reply.text);
      summary.push({
        updateId: update.update_id,
        command: commandLabel(update),
        authorized: reply.authorized !== false,
        kind: reply.kind || "reply",
        sent: Boolean(reply.chatId),
      });
    } catch (error) {
      logger?.error?.(`Live poll update ${update.update_id} failed: ${error.message}`);
      summary.push({
        updateId: update.update_id,
        command: commandLabel(update),
        authorized: false,
        kind: "error",
        sent: false,
      });
    }
  }

  if (nextOffset > 0) {
    await telegram.getUpdates({ offset: nextOffset, timeout: 0 });
  }
  session?.persist?.();

  return {
    updateCount: updates.length,
    nextOffset,
    writesAllowed: config.telegram.confirmWrites,
    summary,
  };
}

export async function main() {
  const result = await runLivePollOnce();
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error("Live poll-once smoke failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
}
