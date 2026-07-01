import { URL, URLSearchParams } from "node:url";
import { loadAuth, saveAuth } from "./auth-store.mjs";

export const API_BASE = "https://api.ticktick.com/open/v1";
export const OAUTH_AUTHORIZE_URL = "https://ticktick.com/oauth/authorize";
export const OAUTH_TOKEN_URL = "https://ticktick.com/oauth/token";
export const DEFAULT_SCOPE = "tasks:read tasks:write";

export class TickTickError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "TickTickError";
    this.details = details;
  }
}

export function parseMaybeRedirectCode(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    const parsed = new URL(value);
    return parsed.searchParams.get("code");
  }
  return value;
}

export function buildAuthUrl({ state = "chatgpt" } = {}) {
  const auth = loadAuth();
  if (!auth.clientId) {
    throw new TickTickError("Missing TickTick OAuth client ID. Set TICKTICK_CLIENT_ID or call ticktick_set_oauth_app first.");
  }
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", auth.clientId);
  url.searchParams.set("scope", DEFAULT_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", auth.redirectUri);
  return { authUrl: url.toString(), redirectUri: auth.redirectUri };
}

async function readResponseBody(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!text) return {};
  if (contentType.includes("json")) return JSON.parse(text);
  const params = new URLSearchParams(text);
  if ([...params.keys()].length > 0) return Object.fromEntries(params.entries());
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function normalizeTokenPayload(payload, existing = {}) {
  const accessToken = payload.access_token || payload.accessToken || payload.token || payload.text;
  const refreshToken = payload.refresh_token || payload.refreshToken || existing.refreshToken;
  const expiresInRaw = payload.expires_in || payload.expiresIn;
  const expiresIn = expiresInRaw ? Number(expiresInRaw) : null;
  return {
    ...existing,
    accessToken,
    refreshToken,
    tokenType: payload.token_type || payload.tokenType || "Bearer",
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : existing.expiresAt || null,
    scope: payload.scope || existing.scope || DEFAULT_SCOPE,
  };
}

async function exchangeToken(params) {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new TickTickError(`TickTick OAuth failed (${response.status})`, { status: response.status, body });
  }
  return body;
}

export async function exchangeAuthorizationCode(codeOrUrl) {
  const auth = loadAuth();
  if (!auth.clientId || !auth.clientSecret) {
    throw new TickTickError("Missing TickTick OAuth app credentials. Set TICKTICK_CLIENT_ID and TICKTICK_CLIENT_SECRET first.");
  }
  const code = parseMaybeRedirectCode(codeOrUrl);
  if (!code) throw new TickTickError("Could not find an OAuth code in codeOrUrl.");
  const payload = await exchangeToken({
    grant_type: "authorization_code",
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
    code,
    redirect_uri: auth.redirectUri,
    scope: DEFAULT_SCOPE,
  });
  const updated = normalizeTokenPayload(payload, auth);
  if (!updated.accessToken) {
    throw new TickTickError("TickTick OAuth response did not include an access token.", { payload });
  }
  saveAuth(updated);
  return updated;
}

export async function refreshIfNeeded(auth = loadAuth()) {
  if (!auth.accessToken) {
    throw new TickTickError("TickTick is not authenticated. Visit /oauth/start, call ticktick_get_auth_url + ticktick_exchange_code, or set TICKTICK_ACCESS_TOKEN.");
  }
  const expiresAt = auth.expiresAt ? Number(auth.expiresAt) : null;
  const shouldRefresh = expiresAt && expiresAt - Math.floor(Date.now() / 1000) < 120;
  if (!shouldRefresh || !auth.refreshToken || !auth.clientId || !auth.clientSecret) return auth;
  const payload = await exchangeToken({
    grant_type: "refresh_token",
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
    refresh_token: auth.refreshToken,
  });
  const updated = normalizeTokenPayload(payload, auth);
  saveAuth(updated);
  return updated;
}

export async function ticktickRequest(method, endpoint, body = undefined, query = undefined) {
  const auth = await refreshIfNeeded(loadAuth());
  const url = new URL(`${API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `${auth.tokenType || "Bearer"} ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await readResponseBody(response);
  if (!response.ok) {
    throw new TickTickError(`TickTick API ${method} ${endpoint} failed (${response.status})`, {
      status: response.status,
      body: parsed,
    });
  }
  return parsed;
}

export function parseDate(value) {
  if (!value) return null;
  const normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function ymd(date) {
  return date.toISOString().slice(0, 10);
}

export function configuredTimeZone() {
  return process.env.TICKTICK_DEFAULT_TIMEZONE || process.env.TZ || "";
}

export function ymdInTimeZone(date, timeZone = configuredTimeZone()) {
  if (!timeZone) return ymd(date);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (mapped.year && mapped.month && mapped.day) {
      return `${mapped.year}-${mapped.month}-${mapped.day}`;
    }
  } catch {}
  return ymd(date);
}

export function taskScheduleDate(task) {
  return parseDate(task.dueDate) || parseDate(task.startDate);
}

export function taskDueBucket(task, now = new Date(), { timeZone = configuredTimeZone() } = {}) {
  const due = taskScheduleDate(task);
  if (!due) return "no_due_date";
  const today = ymdInTimeZone(now, timeZone);
  const dueDay = ymdInTimeZone(due, timeZone);
  if (dueDay < today) return "overdue";
  if (dueDay === today) return "today";
  const sevenDays = new Date(now);
  sevenDays.setDate(sevenDays.getDate() + 7);
  if (dueDay <= ymdInTimeZone(sevenDays, timeZone)) return "next_7_days";
  return "later";
}

export function isOpenTask(task) {
  return task.status === undefined || task.status === 0 || task.status === "0";
}

export function prune(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}
