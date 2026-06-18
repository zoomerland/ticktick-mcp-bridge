import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const DEFAULT_SCOPE = "tasks:read tasks:write";
const DEFAULT_REDIRECT_PATH = "/oauth/callback";

function projectRoot() {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

function resolveAuthFile() {
  if (process.env.TICKTICK_AUTH_FILE) {
    return path.resolve(process.env.TICKTICK_AUTH_FILE);
  }
  const dataRoot = process.env.APPDATA
    ? path.join(process.env.APPDATA, "Codex", "ticktick-assistant")
    : path.join(os.homedir(), ".ticktick-assistant");
  return path.join(dataRoot, "auth.json");
}

export const authFile = resolveAuthFile();

export const legacyAuthFile = process.env.APPDATA
  ? path.join(process.env.APPDATA, "Codex", "ticktick-chatgpt-mcp", "auth.json")
  : path.join(os.homedir(), ".ticktick-chatgpt-mcp", "auth.json");

export function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`).replace(/\/+$/, "");
}

export function defaultRedirectUri() {
  return process.env.TICKTICK_REDIRECT_URI || `${publicBaseUrl()}${DEFAULT_REDIRECT_PATH}`;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function loadStoredAuth() {
  const current = readJson(authFile, null);
  if (current) return current;
  if (legacyAuthFile !== authFile) return readJson(legacyAuthFile, {});
  return {};
}

export function loadAuth() {
  const stored = loadStoredAuth();
  return {
    ...stored,
    clientId: process.env.TICKTICK_CLIENT_ID || stored.clientId,
    clientSecret: process.env.TICKTICK_CLIENT_SECRET || stored.clientSecret,
    redirectUri: process.env.TICKTICK_REDIRECT_URI || stored.redirectUri || defaultRedirectUri(),
    accessToken: process.env.TICKTICK_ACCESS_TOKEN || stored.accessToken,
    refreshToken: process.env.TICKTICK_REFRESH_TOKEN || stored.refreshToken,
    expiresAt: process.env.TICKTICK_TOKEN_EXPIRES_AT
      ? Number(process.env.TICKTICK_TOKEN_EXPIRES_AT)
      : stored.expiresAt,
    tokenType: stored.tokenType || (process.env.TICKTICK_ACCESS_TOKEN ? "Bearer" : undefined),
    scope: stored.scope || DEFAULT_SCOPE,
  };
}

export function saveAuth(nextAuth) {
  const existing = loadStoredAuth();
  writeJson(authFile, {
    ...existing,
    ...nextAuth,
    redirectUri: nextAuth.redirectUri || existing.redirectUri || defaultRedirectUri(),
    scope: nextAuth.scope || existing.scope || DEFAULT_SCOPE,
    updatedAt: new Date().toISOString(),
  });
}

export function clearAuth() {
  try {
    fs.rmSync(authFile, { force: true });
  } catch {}
}

export function redactAuth(auth = loadAuth()) {
  return {
    hasOAuthApp: Boolean(auth.clientId && auth.clientSecret),
    hasAccessToken: Boolean(auth.accessToken),
    hasRefreshToken: Boolean(auth.refreshToken),
    tokenType: auth.tokenType || (auth.accessToken ? "Bearer" : null),
    expiresAt: auth.expiresAt || null,
    redirectUri: auth.redirectUri || defaultRedirectUri(),
    scope: auth.scope || DEFAULT_SCOPE,
    storagePath: authFile,
    legacyStoragePath: legacyAuthFile !== authFile ? legacyAuthFile : undefined,
    projectRoot: projectRoot(),
  };
}
