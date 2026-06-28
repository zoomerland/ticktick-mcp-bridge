import crypto from "node:crypto";
import { URLSearchParams } from "node:url";
import { publicBaseUrl } from "./auth-store.mjs";

const DEFAULT_SCOPE = "ticktick:read ticktick:write";
const TOKEN_TTL_SECONDS = 60 * 60;
const CODE_TTL_MS = 5 * 60 * 1000;
const authorizationCodes = new Map();

function baseUrl() {
  return publicBaseUrl();
}

function scopes() {
  return (process.env.CHATGPT_OAUTH_SCOPES || DEFAULT_SCOPE).split(/\s+/).filter(Boolean);
}

function clientId() {
  return process.env.CHATGPT_OAUTH_CLIENT_ID || "ticktick-mcp-chatgpt";
}

function clientSecret() {
  return process.env.CHATGPT_OAUTH_CLIENT_SECRET || process.env.APP_SHARED_SECRET || "";
}

function tokenSecret() {
  return process.env.CHATGPT_OAUTH_TOKEN_SECRET || process.env.APP_SHARED_SECRET || clientSecret();
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function resource() {
  return baseUrl();
}

function metadataUrl() {
  return `${baseUrl()}/.well-known/oauth-protected-resource`;
}

export function oauthChallenge({ error = "invalid_token", description = "Authorization is required." } = {}) {
  return `Bearer resource_metadata="${metadataUrl()}", scope="${scopes().join(" ")}", error="${error}", error_description="${description}"`;
}

export function chatgptToolSecuritySchemes() {
  return [{ type: "oauth2", scopes: scopes() }];
}

export function protectedResourceMetadata() {
  return {
    resource: resource(),
    authorization_servers: [baseUrl()],
    scopes_supported: scopes(),
    bearer_methods_supported: ["header"],
    resource_documentation: `${baseUrl()}/health`,
  };
}

export function authorizationServerMetadata() {
  return {
    issuer: baseUrl(),
    authorization_endpoint: `${baseUrl()}/oauth/authorize`,
    token_endpoint: `${baseUrl()}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: clientSecret()
      ? ["client_secret_post", "client_secret_basic"]
      : ["none"],
    scopes_supported: scopes(),
    client_id_metadata_document_supported: false,
  };
}

function parseBasicAuth(header = "") {
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return {};
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return {};
  return {
    client_id: decoded.slice(0, separator),
    client_secret: decoded.slice(separator + 1),
  };
}

function checkClientCredentials(params, req) {
  const basic = parseBasicAuth(req.headers.authorization || "");
  const suppliedId = basic.client_id || params.client_id || "";
  const suppliedSecret = basic.client_secret || params.client_secret || "";
  if (!timingSafeEqualString(suppliedId, clientId())) {
    throw new Error("Invalid OAuth client_id.");
  }
  const expectedSecret = clientSecret();
  if (expectedSecret && !timingSafeEqualString(suppliedSecret, expectedSecret)) {
    throw new Error("Invalid OAuth client_secret.");
  }
}

function allowedRedirectUri(redirectUri) {
  try {
    const parsed = new URL(redirectUri);
    return parsed.origin === "https://chatgpt.com"
      && (parsed.pathname.startsWith("/connector/oauth/")
        || parsed.pathname === "/connector_platform_oauth_redirect");
  } catch {
    return false;
  }
}

function redirectWithError(res, redirectUri, state, error, description) {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  target.searchParams.set("error_description", description);
  if (state) target.searchParams.set("state", state);
  res.writeHead(302, { Location: target.toString() });
  res.end();
}

function validateAuthorizeParams(params) {
  const responseType = params.get("response_type");
  const requestedClientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  if (responseType !== "code") throw new Error("response_type must be code.");
  if (requestedClientId !== clientId()) throw new Error("Unknown client_id.");
  if (!redirectUri || !allowedRedirectUri(redirectUri)) throw new Error("redirect_uri is not allowed.");
  if (!codeChallenge || codeChallengeMethod !== "S256") throw new Error("PKCE S256 is required.");
}

export function handleAuthorize(req, res, sendHtml) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    validateAuthorizeParams(url.searchParams);
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state") || "";
    const requestedResource = url.searchParams.get("resource") || resource();
    if (requestedResource !== resource()) throw new Error("Invalid resource audience.");

    const code = randomToken();
    authorizationCodes.set(code, {
      clientId: url.searchParams.get("client_id"),
      redirectUri,
      codeChallenge: url.searchParams.get("code_challenge"),
      resource: requestedResource,
      scope: url.searchParams.get("scope") || scopes().join(" "),
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    if (state) target.searchParams.set("state", state);
    res.writeHead(302, { Location: target.toString() });
    res.end();
  } catch (error) {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state") || "";
    if (redirectUri && allowedRedirectUri(redirectUri)) {
      redirectWithError(res, redirectUri, state, "invalid_request", error.message);
      return;
    }
    sendHtml(res, 400, `<!doctype html><meta charset="utf-8"><title>OAuth error</title><body><h1>OAuth error</h1><pre>${escapeHtml(error.message)}</pre></body>`);
  }
}

async function readFormRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function pkceChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function signAccessToken(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", tokenSecret()).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export async function handleToken(req, res, sendJson) {
  try {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    const params = await readFormRequest(req);
    checkClientCredentials(Object.fromEntries(params.entries()), req);
    if (params.get("grant_type") !== "authorization_code") throw new Error("Unsupported grant_type.");
    const code = params.get("code") || "";
    const record = authorizationCodes.get(code);
    authorizationCodes.delete(code);
    if (!record || record.expiresAt < Date.now()) throw new Error("Invalid or expired authorization code.");
    if (params.get("redirect_uri") !== record.redirectUri) throw new Error("redirect_uri mismatch.");
    if (params.get("resource") && params.get("resource") !== record.resource) throw new Error("resource mismatch.");
    const verifier = params.get("code_verifier") || "";
    if (!verifier || pkceChallenge(verifier) !== record.codeChallenge) throw new Error("PKCE verification failed.");

    const now = Math.floor(Date.now() / 1000);
    const scope = record.scope || scopes().join(" ");
    const accessToken = signAccessToken({
      iss: baseUrl(),
      aud: record.resource,
      resource: record.resource,
      sub: "ticktick-mcp-single-user",
      client_id: record.clientId,
      scope,
      iat: now,
      nbf: now,
      exp: now + TOKEN_TTL_SECONDS,
      jti: randomToken(16),
    });

    sendJson(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: TOKEN_TTL_SECONDS,
      scope,
    }, { "Cache-Control": "no-store", Pragma: "no-cache" });
  } catch (error) {
    sendJson(res, 400, {
      error: "invalid_grant",
      error_description: error instanceof Error ? error.message : String(error),
    }, { "Cache-Control": "no-store", Pragma: "no-cache" });
  }
}

export function verifyOAuthAccessToken(token) {
  try {
    if (!tokenSecret()) return false;
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedPayload, signature] = parts;
    const expected = crypto.createHmac("sha256", tokenSecret()).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
    if (!timingSafeEqualString(signature, expected)) return false;
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== baseUrl()) return false;
    if (payload.aud !== resource() && payload.resource !== resource()) return false;
    if (Number(payload.exp || 0) <= now) return false;
    if (Number(payload.nbf || 0) > now) return false;
    const tokenScopes = new Set(String(payload.scope || "").split(/\s+/).filter(Boolean));
    return scopes().every((scope) => tokenScopes.has(scope));
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
