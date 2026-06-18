import { TickTickError } from "./ticktick-api.mjs";
import { toolMap, tools } from "./tools.mjs";

export const SERVER_INFO = {
  name: "ticktick-mcp-bridge",
  version: "0.3.1+codex.20260618-163502",
};

export function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(id, error, code = -32000, data = undefined) {
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

export function listToolDescriptors() {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function handleRpc(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: params?.protocolVersion || "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === "notifications/initialized") return null;
  if (method === "ping") return rpcResult(id, {});

  if (method === "tools/list") {
    return rpcResult(id, { tools: listToolDescriptors() });
  }

  if (method === "tools/call") {
    const tool = toolMap[params?.name];
    if (!tool) return rpcError(id, `Unknown tool: ${params?.name}`, -32602);

    try {
      const result = await tool.handler(params?.arguments || {});
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result ?? {}, null, 2) }],
      });
    } catch (error) {
      return rpcResult(id, {
        isError: true,
        content: [{
          type: "text",
          text: error instanceof TickTickError
            ? JSON.stringify({ error: error.message, details: error.details }, null, 2)
            : error instanceof Error ? error.message : String(error),
        }],
      });
    }
  }

  if (id === undefined || id === null) return null;
  return rpcError(id, `Unsupported method: ${method}`, -32601);
}
