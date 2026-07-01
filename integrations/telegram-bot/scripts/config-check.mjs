import { pathToFileURL } from "node:url";
import { loadConfig, loadEnvWithFile } from "../src/config.mjs";

function countSet(values) {
  return values?.size || 0;
}

function present(value) {
  return value ? "set" : "missing";
}

function bridgeTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function originTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "invalid-url";
  }
}

function bool(value) {
  return value ? "true" : "false";
}

export function buildConfigSummary(config) {
  return [
    "Telegram bot config check",
    `dryRun: ${bool(config.dryRun)}`,
    `botMode: ${config.telegram.botMode}`,
    `telegramToken: ${present(config.telegram.botToken)}`,
    `allowedUsers: ${countSet(config.telegram.allowedUserIds)}`,
    `allowedChats: ${countSet(config.telegram.allowedChatIds)}`,
    `confirmWrites: ${bool(config.telegram.confirmWrites)}`,
    `proactiveEnabled: ${bool(config.telegram.proactiveEnabled)}`,
    `proactiveChatId: ${present(config.telegram.proactiveChatId)}`,
    `checkinEnabled: ${bool(config.telegram.checkinEnabled)}`,
    `checkinChatId: ${present(config.telegram.checkinChatId)}`,
    `checkinHours: ${config.telegram.checkinHours.startHour}-${config.telegram.checkinHours.endHour}`,
    `remindersEnabled: ${bool(config.telegram.remindersEnabled)}`,
    `reminderChatId: ${present(config.telegram.reminderChatId)}`,
    `travelDefaultMinutes: ${config.telegram.travelDefaultMinutes}`,
    `travelBufferMinutes: ${config.telegram.travelBufferMinutes}`,
    `projectRoutes: ${config.telegram.projectRoutes.length}`,
    `voiceEnabled: ${bool(config.telegram.voiceEnabled)}`,
    `voiceProvider: ${config.telegram.voiceProvider}`,
    `voiceMockTranscript: ${present(config.telegram.voiceMockTranscript)}`,
    `voiceDownloadEnabled: ${bool(config.telegram.voiceDownloadEnabled)}`,
    `voiceMaxBytes: ${config.telegram.voiceMaxBytes}`,
    `voiceHttpUrl: ${present(config.telegram.voiceHttpUrl)}`,
    `voiceHttpToken: ${present(config.telegram.voiceHttpToken)}`,
    `stateFile: ${config.operational.stateFile}`,
    `bridgeUrl: ${bridgeTarget(config.bridge.url)}`,
    `bridgeBearerToken: ${present(config.bridge.bearerToken)}`,
    `startupDiagnostics: ${bool(config.bridge.startupDiagnostics)}`,
    `llmEnabled: ${bool(config.llm.enabled)}`,
    `llmProvider: ${config.llm.provider}`,
    `llmBaseUrl: ${originTarget(config.llm.baseUrl)}`,
    `llmOllamaKeepAlive: ${config.llm.ollamaKeepAlive || "default"}`,
    `llmOpenAiBaseUrl: ${originTarget(config.llm.openaiBaseUrl)}`,
    `llmOpenAiApiKey: ${present(config.llm.openaiApiKey)}`,
    `llmModel: ${config.llm.model}`,
    `llmRouterModel: ${config.llm.routerModel}`,
    `llmExecutorModel: ${config.llm.executorModel}`,
    `llmChatModel: ${config.llm.chatModel}`,
    `llmFailClosed: ${bool(config.llm.failClosed)}`,
  ].join("\n");
}

export function main(env = process.env) {
  const config = loadConfig(loadEnvWithFile(env));
  const summary = buildConfigSummary(config);

  if (config.errors.length) {
    console.error(summary);
    console.error("");
    console.error("Invalid configuration:");
    for (const error of config.errors) {
      console.error(`- ${error}`);
    }
    return 1;
  }

  console.log(summary);
  console.log("");
  console.log("Configuration is valid for startup.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
