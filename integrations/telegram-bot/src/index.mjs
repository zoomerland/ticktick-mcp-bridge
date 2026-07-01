import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig, loadEnvWithFile, assertValidConfig } from "./config.mjs";
import { McpBridgeClient } from "./bridge-client.mjs";
import { createLlmClient } from "./llm-client.mjs";
import { TelegramClient, pollOnce } from "./telegram-client.mjs";
import { RateLimiter } from "./rate-limit.mjs";
import { createLogger } from "./logger.mjs";
import { startProactiveLoop } from "./proactive-scheduler.mjs";
import { startCheckinLoop } from "./checkin-scheduler.mjs";
import { startReminderLoop } from "./reminder-scheduler.mjs";
import { createSessionStore } from "./state-file.mjs";

export async function createRuntime(env = process.env) {
  const config = assertValidConfig(loadConfig(loadEnvWithFile(env)));
  const logger = createLogger({ level: config.operational.logLevel });
  const bridge = new McpBridgeClient(config.bridge);
  const telegram = new TelegramClient({ token: config.telegram.botToken });
  const llmClient = createLlmClient(config.llm);
  const session = createSessionStore(config);
  const rateLimiter = new RateLimiter({
    windowMs: config.operational.rateLimitWindowMs,
    maxCommands: config.operational.rateLimitMaxCommands,
  });
  return { config, logger, bridge, telegram, llmClient, rateLimiter, session };
}

export async function runStartupDiagnostics({ config, bridge, logger }) {
  await bridge.initialize();
  if (!config.bridge.startupDiagnostics) return;
  const diagnostics = await bridge.callTool("ticktick_diagnostics", { includeTaskCounts: true });
  logger.info(`Bridge diagnostics ok: ${diagnostics?.ok !== false}`);
}

export async function startPolling(runtime) {
  const { config, logger, bridge, telegram, llmClient, rateLimiter, session } = runtime;
  await runStartupDiagnostics(runtime);
  if (config.telegram.proactiveEnabled) {
    startProactiveLoop(runtime).catch((error) => {
      logger.error(`Proactive loop stopped: ${error.message}`);
    });
  }
  if (config.telegram.checkinEnabled) {
    startCheckinLoop(runtime).catch((error) => {
      logger.error(`Check-in loop stopped: ${error.message}`);
    });
  }
  if (config.telegram.remindersEnabled) {
    startReminderLoop(runtime).catch((error) => {
      logger.error(`Reminder loop stopped: ${error.message}`);
    });
  }
  let offset = 0;
  logger.info("Telegram secretary polling started.");
  while (true) {
    try {
      offset = await pollOnce({ telegram, bridge, config, llmClient, rateLimiter, session, logger, offset });
    } catch (error) {
      logger.error(`Polling error: ${error.message}`);
      await sleep(config.telegram.pollingIntervalMs);
    }
  }
}

export async function main() {
  await startPolling(await createRuntime());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
