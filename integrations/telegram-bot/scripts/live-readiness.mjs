import { pathToFileURL } from "node:url";
import { loadConfig, loadEnvWithFile } from "../src/config.mjs";
import { buildConfigSummary } from "./config-check.mjs";
import { runBridgeReadOnlySmoke } from "./bridge-readonly-smoke.mjs";

function present(value) {
  return value ? "set" : "missing";
}

function redactSecrets(text, config) {
  const secrets = [
    config.telegram.botToken,
    config.bridge.bearerToken,
    config.telegram.voiceHttpToken,
    config.telegram.voiceMockTranscript,
  ].filter(Boolean);

  let redacted = String(text || "");
  for (const secret of secrets) {
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

function liveConfigErrors(config) {
  return config.dryRun ? [] : config.errors;
}

function nextSteps(config) {
  if (config.dryRun) {
    return [
      "Dry-run mode is enabled.",
      "For a live Telegram getMe check, set TELEGRAM_DRY_RUN=false with TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_IDS.",
    ];
  }

  if (!config.errors.length) return [];
  return [
    "Live Telegram startup is blocked until configuration is complete.",
    ...config.errors.map((error) => `- ${error}`),
    "Next step: set the missing Telegram values in .env or the service environment, then rerun live-readiness.",
  ];
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${label}`);
  }
}

export async function runTelegramGetMe({ config, fetchImpl = fetch } = {}) {
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/getMe`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await readJsonResponse(response, "Telegram getMe");

  if (!response.ok || !body.ok) {
    return {
      ok: false,
      text: [
        "Telegram getMe",
        `ok: false`,
        `error: ${body.description || `HTTP ${response.status || "unknown"}`}`,
      ].join("\n"),
    };
  }

  return {
    ok: true,
    text: [
      "Telegram getMe",
      "ok: true",
      `botId: ${present(body.result?.id)}`,
      `username: ${body.result?.username ? `@${body.result.username}` : "missing"}`,
      `isBot: ${body.result?.is_bot === true ? "true" : "unknown"}`,
    ].join("\n"),
  };
}

function shouldRunTelegramGetMe(config) {
  return Boolean(config.telegram.botToken) && liveConfigErrors(config).length === 0;
}

function telegramSkipText(config) {
  const lines = ["Telegram getMe", "skipped: true"];
  if (!config.telegram.botToken) {
    lines.push("reason: TELEGRAM_BOT_TOKEN is missing");
  } else if (liveConfigErrors(config).length) {
    lines.push("reason: live configuration is incomplete");
  } else {
    lines.push("reason: dry-run mode");
  }
  lines.push(...nextSteps(config));
  return lines.join("\n");
}

export async function runLiveReadiness({
  env = process.env,
  envFilePath = ".env",
  bridgeFetchImpl = fetch,
  telegramFetchImpl = fetch,
  searchQuery,
} = {}) {
  const loadedEnv = loadEnvWithFile(env, envFilePath);
  const config = loadConfig(loadedEnv);
  const lines = [
    "Telegram bot live-readiness preflight",
    buildConfigSummary(config),
  ];
  const errors = [];

  if (config.errors.length) {
    lines.push("");
    lines.push("Config status");
    for (const line of nextSteps(config)) lines.push(line);
    if (!config.dryRun) errors.push(...config.errors);
  } else {
    lines.push("");
    lines.push("Config status");
    lines.push(config.dryRun ? "Valid for dry-run checks." : "Valid for live startup.");
  }

  try {
    const bridgeResult = await runBridgeReadOnlySmoke({
      config,
      searchQuery: searchQuery ?? loadedEnv.BRIDGE_SMOKE_SEARCH_QUERY ?? "",
      fetchImpl: bridgeFetchImpl,
    });
    lines.push("");
    lines.push(bridgeResult.text);
    if (!bridgeResult.ok) errors.push("Bridge read-only smoke failed");
  } catch (error) {
    lines.push("");
    lines.push("Bridge read-only smoke failed.");
    lines.push(`error: ${error.message}`);
    errors.push("Bridge read-only smoke failed");
  }

  if (shouldRunTelegramGetMe(config)) {
    try {
      const telegramResult = await runTelegramGetMe({ config, fetchImpl: telegramFetchImpl });
      lines.push("");
      lines.push(telegramResult.text);
      if (!telegramResult.ok) errors.push("Telegram getMe failed");
    } catch (error) {
      lines.push("");
      lines.push("Telegram getMe");
      lines.push("ok: false");
      lines.push(`error: ${error.message}`);
      errors.push("Telegram getMe failed");
    }
  } else {
    lines.push("");
    lines.push(telegramSkipText(config));
  }

  const ok = errors.length === 0;
  lines.push("");
  lines.push(ok ? "Live-readiness preflight passed." : "Live-readiness preflight failed closed.");

  return {
    ok,
    errors,
    config,
    text: redactSecrets(lines.join("\n"), config),
  };
}

export async function main(env = process.env) {
  const result = await runLiveReadiness({ env });
  console.log(result.text);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error("Telegram bot live-readiness preflight failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
}
