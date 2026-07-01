export function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function parseInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createConfigError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseStringArray(value, name) {
  if (value === undefined || value === "") return undefined;
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw createConfigError(`${name} must be a JSON string array.`, "invalid_config");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw createConfigError(`${name} must be a JSON string array.`, "invalid_config");
  }
  return parsed;
}

function loadCommandConfig(env) {
  const command = String(env.STT_COMMAND || "").trim();
  if (!command) {
    throw createConfigError(
      "STT_COMMAND is required when STT_PROVIDER=command.",
      "stt_command_missing",
    );
  }

  const args = parseStringArray(env.STT_COMMAND_ARGS, "STT_COMMAND_ARGS") || ["{audio}"];
  if (!args.some((arg) => arg.includes("{audio}"))) {
    throw createConfigError(
      "STT_COMMAND_ARGS must include the {audio} placeholder.",
      "stt_command_audio_placeholder_missing",
    );
  }

  const timeoutMs = parseInteger(env.STT_COMMAND_TIMEOUT_MS, 30_000);
  if (timeoutMs <= 0) {
    throw createConfigError(
      "STT_COMMAND_TIMEOUT_MS must be greater than zero.",
      "invalid_config",
    );
  }

  return {
    command,
    args,
    timeoutMs,
  };
}

export function loadConfig(env = process.env) {
  const provider = String(env.STT_PROVIDER || "mock").trim().toLowerCase();
  const config = {
    host: env.STT_HOST || "127.0.0.1",
    port: parseInteger(env.STT_PORT, 9876),
    provider,
    mockTranscript: env.STT_MOCK_TRANSCRIPT || "",
    bearerToken: env.STT_BEARER_TOKEN || "",
    maxAudioBytes: parseInteger(env.STT_MAX_AUDIO_BYTES, 10 * 1024 * 1024),
    logRequests: parseBoolean(env.STT_LOG_REQUESTS, false),
  };

  if (provider === "command") {
    config.command = loadCommandConfig(env);
  }

  return config;
}
