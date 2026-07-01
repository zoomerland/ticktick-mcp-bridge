import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../src/config.mjs";

const DEFAULT_ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

function bool(value) {
  return value ? "true" : "false";
}

function present(value) {
  return value ? "set" : "missing";
}

function unquoteValue(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed.replace(/\s+#.*$/, "").trim();

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    const inner = trimmed.slice(1, -1);
    if (first === "'") return inner;
    return inner
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replaceAll("\\\"", "\"")
      .replaceAll("\\\\", "\\");
  }

  return trimmed.replace(/\s+#.*$/, "").trim();
}

export function parseEnvFile(text) {
  const parsed = {};
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const equalsIndex = withoutExport.indexOf("=");
    if (equalsIndex === -1) {
      throw new Error(`Invalid .env line ${index + 1}: expected KEY=value.`);
    }

    const key = withoutExport.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid .env line ${index + 1}: invalid key "${key}".`);
    }

    parsed[key] = unquoteValue(withoutExport.slice(equalsIndex + 1));
  }

  return parsed;
}

export function loadEnvWithFile(env = process.env, envPath = DEFAULT_ENV_PATH) {
  const fileEnv = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : {};
  return {
    ...fileEnv,
    ...env,
  };
}

export function buildConfigSummary(config, metadata = {}) {
  const lines = [
    "Local STT service config check",
    `envFile: ${metadata.envFilePresent ? "loaded" : "not found"}`,
    `host: ${config.host}`,
    `port: ${config.port}`,
    `provider: ${config.provider}`,
    `bearerToken: ${present(config.bearerToken)}`,
    `maxAudioBytes: ${config.maxAudioBytes}`,
    `logRequests: ${bool(config.logRequests)}`,
    `mockTranscript: ${present(config.mockTranscript)}`,
  ];

  if (config.provider === "command") {
    lines.push(
      `command: ${present(config.command?.command)}`,
      `commandArgs: ${config.command?.args?.length || 0}`,
      `commandArgsAudioPlaceholder: ${bool(config.command?.args?.some((arg) => arg.includes("{audio}")))}`,
      `commandTimeoutMs: ${config.command?.timeoutMs || 0}`,
    );
  }

  return lines.join("\n");
}

export function main(env = process.env, envPath = DEFAULT_ENV_PATH) {
  const envFilePresent = existsSync(envPath);

  try {
    const config = loadConfig(loadEnvWithFile(env, envPath));
    console.log(buildConfigSummary(config, { envFilePresent }));
    console.log("");
    console.log("Configuration is valid for startup.");
    return 0;
  } catch (error) {
    console.error("Local STT service config check");
    console.error(`envFile: ${envFilePresent ? "loaded" : "not found"}`);
    console.error("");
    console.error("Invalid configuration:");
    console.error(`- ${error.message}`);
    if (error.code) console.error(`code: ${error.code}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
