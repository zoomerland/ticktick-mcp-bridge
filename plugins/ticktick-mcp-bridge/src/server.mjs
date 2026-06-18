import http from "node:http";
import { URL } from "node:url";
import { buildAuthUrl, exchangeAuthorizationCode } from "./ticktick-api.mjs";
import { redactAuth } from "./auth-store.mjs";
import { handleRpc, listToolDescriptors, SERVER_INFO } from "./mcp-handler.mjs";

const PORT = Number(process.env.PORT || 8787);
const APP_SHARED_SECRET = process.env.APP_SHARED_SECRET || "";

function sendJson(res, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version, mcp-session-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...extraHeaders,
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  const body = Buffer.from(html, "utf8");
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

function rpcError(id, error, code = -32000, data = undefined) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
      ...(data ? { data } : {}),
    },
  };
}

async function readJsonRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function isAuthorized(req) {
  if (!APP_SHARED_SECRET) return true;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${APP_SHARED_SECRET}`;
}

async function handleMcp(req, res) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }
  if (req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`event: endpoint\ndata: /mcp\n\n`);
    res.write(`event: ready\ndata: {}\n\n`);
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  let message;
  try {
    message = await readJsonRequest(req);
  } catch (error) {
    sendJson(res, 400, rpcError(null, "Invalid JSON", -32700));
    return;
  }
  const messages = Array.isArray(message) ? message : [message];
  const responses = (await Promise.all(messages.map(handleRpc))).filter(Boolean);
  if (Array.isArray(message)) sendJson(res, 200, responses);
  else if (responses.length) sendJson(res, 200, responses[0]);
  else res.writeHead(202).end();
}

async function handleOAuthStart(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const state = url.searchParams.get("state") || "chatgpt";
    const { authUrl } = buildAuthUrl({ state });
    res.writeHead(302, { Location: authUrl });
    res.end();
  } catch (error) {
    sendHtml(res, 500, `<pre>${escapeHtml(error.message)}</pre>`);
  }
}

async function handleOAuthCallback(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const error = url.searchParams.get("error");
    if (error) throw new Error(`TickTick OAuth returned error: ${error}`);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("OAuth callback did not include a code.");
    const auth = await exchangeAuthorizationCode(code);
    sendHtml(res, 200, `<!doctype html><meta charset="utf-8"><title>TickTick connected</title><body style="font-family:system-ui;margin:40px"><h1>TickTick connected</h1><p>The MCP server can now access TickTick.</p><pre>${escapeHtml(JSON.stringify(redactAuth(auth), null, 2))}</pre></body>`);
  } catch (error) {
    sendHtml(res, 500, `<!doctype html><meta charset="utf-8"><title>TickTick auth error</title><body style="font-family:system-ui;margin:40px"><h1>TickTick auth error</h1><pre>${escapeHtml(error.message)}</pre></body>`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  if (url.pathname === "/" || url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      mcp: "/mcp",
      oauthStart: "/oauth/start",
      auth: redactAuth(),
      tools: listToolDescriptors().map((tool) => tool.name),
    });
    return;
  }
  if (url.pathname === "/tools") {
    sendJson(res, 200, { tools: listToolDescriptors() });
    return;
  }
  if (url.pathname === "/mcp" || url.pathname === "/sse") {
    await handleMcp(req, res);
    return;
  }
  if (url.pathname === "/oauth/start") {
    await handleOAuthStart(req, res);
    return;
  }
  if (url.pathname === "/oauth/callback") {
    await handleOAuthCallback(req, res);
    return;
  }
  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  const auth = redactAuth();
  console.log(`${SERVER_INFO.name} HTTP MCP transport listening on http://127.0.0.1:${PORT}`);
  console.log(`MCP endpoint: /mcp`);
  console.log(`Tools registered: ${listToolDescriptors().length}`);
  console.log(`TickTick auth configured: ${auth.hasAccessToken ? "yes" : "no"} (${auth.storagePath})`);
});
