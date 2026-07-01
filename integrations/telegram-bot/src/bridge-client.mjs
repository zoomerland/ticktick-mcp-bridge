export class McpBridgeError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "McpBridgeError";
    this.details = details;
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new McpBridgeError(`Invalid JSON from ${label}`, { text, cause: error.message });
  }
}

export function parseToolResult(result) {
  if (result?.isError) {
    const text = result.content?.map((item) => item.text).filter(Boolean).join("\n") || "Tool call failed";
    throw new McpBridgeError(text, result);
  }

  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (text === undefined) return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export class McpBridgeClient {
  constructor({ url, bearerToken = "", timeoutMs = 15000, fetchImpl = fetch }) {
    this.url = url;
    this.bearerToken = bearerToken;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.nextId = 1;
  }

  async rpc(method, params = undefined) {
    const id = this.nextId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = { "Content-Type": "application/json" };
    if (this.bearerToken) headers.Authorization = `Bearer ${this.bearerToken}`;

    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
      const text = await response.text();
      const body = parseJson(text, "MCP bridge");
      if (!response.ok) {
        throw new McpBridgeError(`MCP bridge HTTP ${response.status}`, body);
      }
      if (body.error) {
        throw new McpBridgeError(body.error.message || "MCP JSON-RPC error", body.error);
      }
      return body.result;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new McpBridgeError(`MCP bridge request timed out after ${this.timeoutMs}ms`);
      }
      if (error instanceof McpBridgeError) throw error;
      throw new McpBridgeError(error.message || String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  initialize() {
    return this.rpc("initialize", { protocolVersion: "2025-03-26" });
  }

  listTools() {
    return this.rpc("tools/list", {});
  }

  async callTool(name, args = {}) {
    return parseToolResult(await this.rpc("tools/call", { name, arguments: args }));
  }
}
