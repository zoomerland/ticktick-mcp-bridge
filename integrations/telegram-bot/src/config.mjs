import { existsSync, readFileSync } from "node:fs";

export class ConfigError extends Error {
  constructor(errors) {
    super(`Invalid Telegram bot configuration: ${errors.join("; ")}`);
    this.name = "ConfigError";
    this.errors = errors;
  }
}

export function parseEnvFile(text) {
  const values = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function loadEnvWithFile(env = process.env, envFilePath = ".env") {
  const fileValues = existsSync(envFilePath)
    ? parseEnvFile(readFileSync(envFilePath, "utf8"))
    : {};
  return { ...fileValues, ...env };
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseQuietHours(value) {
  const text = String(value || "23-8").trim();
  const match = text.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!match) return { startHour: 23, endHour: 8 };
  return {
    startHour: Math.max(0, Math.min(23, Number.parseInt(match[1], 10))),
    endHour: Math.max(0, Math.min(23, Number.parseInt(match[2], 10))),
  };
}

export function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseIdSet(value) {
  return new Set(parseList(value).map(String));
}

export function parseProjectRoutes(value) {
  return String(value || "")
    .split(/[;,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([^=:]+)\s*[=:]\s*([^\s|]+)(?:\|(.+))?$/);
      if (!match) return null;
      return {
        keyword: match[1].trim().toLowerCase(),
        projectId: match[2].trim(),
        projectName: (match[3] || "").trim(),
      };
    })
    .filter((route) => route?.keyword && route?.projectId);
}

export function loadConfig(env = process.env) {
  const dryRun = parseBoolean(env.TELEGRAM_DRY_RUN, false);
  const botMode = env.TELEGRAM_BOT_MODE || "polling";
  const llmProvider = env.TELEGRAM_LLM_PROVIDER || "ollama";
  const llmEnabled = parseBoolean(env.TELEGRAM_LLM_ENABLED, false);
  const llmModel = llmProvider === "openai"
    ? (env.TELEGRAM_LLM_OPENAI_MODEL || "")
    : (env.TELEGRAM_LLM_MODEL || "qwen3:14b");
  const allowedUserIds = parseIdSet(env.TELEGRAM_ALLOWED_USER_IDS);
  const allowedChatIds = parseIdSet(env.TELEGRAM_ALLOWED_CHAT_IDS);
  const errors = [];

  if (!dryRun && !env.TELEGRAM_BOT_TOKEN) {
    errors.push("TELEGRAM_BOT_TOKEN is required for live polling");
  }
  if (!dryRun && allowedUserIds.size === 0) {
    errors.push("TELEGRAM_ALLOWED_USER_IDS is required for live polling");
  }
  if (botMode !== "polling") {
    errors.push(`Unsupported TELEGRAM_BOT_MODE: ${botMode}`);
  }
  if (llmEnabled && !["ollama", "openai"].includes(llmProvider)) {
    errors.push(`Unsupported TELEGRAM_LLM_PROVIDER: ${llmProvider}`);
  }
  if (llmEnabled && llmProvider === "openai") {
    if (!env.TELEGRAM_LLM_OPENAI_API_KEY && !env.OPENAI_API_KEY) {
      errors.push("TELEGRAM_LLM_OPENAI_API_KEY or OPENAI_API_KEY is required for provider=openai");
    }
    if (!env.TELEGRAM_LLM_OPENAI_MODEL) {
      errors.push("TELEGRAM_LLM_OPENAI_MODEL is required for provider=openai");
    }
  }

  return {
    dryRun,
    errors,
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN || "",
      allowedUserIds,
      allowedChatIds,
      adminUserIds: parseIdSet(env.TELEGRAM_ADMIN_USER_IDS),
      botMode,
      pollingTimeoutSeconds: parseInteger(env.TELEGRAM_POLLING_TIMEOUT_SECONDS, 30),
      pollingIntervalMs: parseInteger(env.TELEGRAM_POLLING_INTERVAL_MS, 1000),
      confirmWrites: parseBoolean(env.TELEGRAM_CONFIRM_WRITES, false),
      requireProjectForCreation: parseBoolean(env.TELEGRAM_REQUIRE_PROJECT_FOR_CREATION, true),
      defaultProjectId: env.TELEGRAM_DEFAULT_PROJECT_ID || "",
      defaultProjectName: env.TELEGRAM_DEFAULT_PROJECT_NAME || "",
      projectRoutes: parseProjectRoutes(env.TELEGRAM_PROJECT_ROUTES),
      defaultTimezone: env.TELEGRAM_DEFAULT_TIMEZONE || "Europe/Moscow",
      maxResults: parseInteger(env.TELEGRAM_MAX_RESULTS, 10),
      proactiveEnabled: parseBoolean(env.TELEGRAM_PROACTIVE_ENABLED, false),
      proactiveChatId: env.TELEGRAM_PROACTIVE_CHAT_ID || "",
      proactiveIntervalMs: parseInteger(env.TELEGRAM_PROACTIVE_INTERVAL_MINUTES, 60) * 60 * 1000,
      quietHours: parseQuietHours(env.TELEGRAM_QUIET_HOURS),
      checkinEnabled: parseBoolean(env.TELEGRAM_CHECKIN_ENABLED, false),
      checkinChatId: env.TELEGRAM_CHECKIN_CHAT_ID || "",
      checkinIntervalMs: parseInteger(env.TELEGRAM_CHECKIN_INTERVAL_MINUTES, 120) * 60 * 1000,
      checkinHours: parseQuietHours(env.TELEGRAM_CHECKIN_HOURS || "9-21"),
      reminderLeadMinutes: parseInteger(env.TELEGRAM_REMINDER_LEAD_MINUTES, 30),
      remindersEnabled: parseBoolean(env.TELEGRAM_REMINDERS_ENABLED, false),
      reminderChatId: env.TELEGRAM_REMINDER_CHAT_ID || "",
      reminderIntervalMs: parseInteger(env.TELEGRAM_REMINDER_INTERVAL_MINUTES, 5) * 60 * 1000,
      travelDefaultMinutes: parseInteger(env.TELEGRAM_TRAVEL_DEFAULT_MINUTES, 45),
      travelBufferMinutes: parseInteger(env.TELEGRAM_TRAVEL_BUFFER_MINUTES, 15),
      voiceEnabled: parseBoolean(env.TELEGRAM_VOICE_ENABLED, false),
      voiceProvider: env.TELEGRAM_VOICE_PROVIDER || "disabled",
      voiceMockTranscript: env.TELEGRAM_VOICE_MOCK_TRANSCRIPT || "",
      voiceDownloadEnabled: parseBoolean(env.TELEGRAM_VOICE_DOWNLOAD_ENABLED, false),
      voiceMaxBytes: parseInteger(env.TELEGRAM_VOICE_MAX_BYTES, 10 * 1024 * 1024),
      voiceHttpUrl: env.TELEGRAM_VOICE_HTTP_URL || "",
      voiceHttpToken: env.TELEGRAM_VOICE_HTTP_TOKEN || "",
      voiceHttpTimeoutMs: parseInteger(env.TELEGRAM_VOICE_HTTP_TIMEOUT_MS, 30000),
    },
    bridge: {
      url: env.TICKTICK_MCP_URL || "http://127.0.0.1:8787/mcp",
      bearerToken: env.TICKTICK_MCP_BEARER_TOKEN || "",
      timeoutMs: parseInteger(env.TICKTICK_MCP_TIMEOUT_MS, 15000),
      startupDiagnostics: parseBoolean(env.TICKTICK_MCP_STARTUP_DIAGNOSTICS, true),
    },
    llm: {
      enabled: llmEnabled,
      provider: llmProvider,
      baseUrl: env.TELEGRAM_LLM_OLLAMA_URL || env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
      model: llmModel,
      routerModel: env.TELEGRAM_LLM_ROUTER_MODEL || llmModel,
      executorModel: env.TELEGRAM_LLM_EXECUTOR_MODEL || llmModel,
      chatModel: env.TELEGRAM_LLM_CHAT_MODEL || llmModel,
      openaiBaseUrl: env.TELEGRAM_LLM_OPENAI_BASE_URL || "https://api.openai.com/v1",
      openaiApiKey: env.TELEGRAM_LLM_OPENAI_API_KEY || env.OPENAI_API_KEY || "",
      openaiModel: llmModel,
      openaiOrganization: env.TELEGRAM_LLM_OPENAI_ORG || env.OPENAI_ORG_ID || "",
      openaiProject: env.TELEGRAM_LLM_OPENAI_PROJECT || env.OPENAI_PROJECT_ID || "",
      timeoutMs: parseInteger(env.TELEGRAM_LLM_TIMEOUT_MS, 120000),
      contextTokens: parseInteger(env.TELEGRAM_LLM_CONTEXT_TOKENS, 4096),
      executorMaxTokens: parseInteger(env.TELEGRAM_LLM_EXECUTOR_MAX_TOKENS, 256),
      chatMaxTokens: parseInteger(env.TELEGRAM_LLM_CHAT_MAX_TOKENS, 512),
      chatTemperature: Number.isFinite(Number.parseFloat(env.TELEGRAM_LLM_CHAT_TEMPERATURE))
        ? Number.parseFloat(env.TELEGRAM_LLM_CHAT_TEMPERATURE)
        : 0.4,
      chatThink: parseBoolean(env.TELEGRAM_LLM_CHAT_THINK, true),
      failClosed: parseBoolean(env.TELEGRAM_LLM_FAIL_CLOSED, true),
    },
    operational: {
      logLevel: env.LOG_LEVEL || "info",
      redactTaskContent: parseBoolean(env.LOG_REDACT_TASK_CONTENT, true),
      rateLimitWindowMs: parseInteger(env.BOT_RATE_LIMIT_WINDOW_MS, 60000),
      rateLimitMaxCommands: parseInteger(env.BOT_RATE_LIMIT_MAX_COMMANDS, 30),
      stateFile: env.TELEGRAM_STATE_FILE || "data/telegram-state.json",
    },
  };
}

export function assertValidConfig(config) {
  if (config.errors.length) throw new ConfigError(config.errors);
  return config;
}
