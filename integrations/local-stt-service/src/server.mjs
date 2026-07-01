import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { transcribePayload } from "./transcribe.mjs";

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      const error = new Error("request_too_large");
      error.code = "request_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function isAuthorized(request, config) {
  if (!config.bearerToken) return true;
  return request.headers.authorization === `Bearer ${config.bearerToken}`;
}

export function createServer(config = loadConfig()) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          provider: config.provider,
          maxAudioBytes: config.maxAudioBytes,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/transcribe") {
        if (!isAuthorized(request, config)) {
          sendJson(response, 401, { error: "unauthorized" });
          return;
        }
        const payload = await readJson(request, config.maxAudioBytes * 2);
        const result = await transcribePayload(payload, config);
        sendJson(response, result.status, result.body);
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      if (error.code === "request_too_large") {
        sendJson(response, 413, { error: "request_too_large" });
        return;
      }
      sendJson(response, 400, { error: "bad_request" });
    }
  });
}

export async function start(config = loadConfig()) {
  const server = createServer(config);
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then((server) => {
    const address = server.address();
    console.log(`Local STT service listening on ${address.address}:${address.port}`);
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
