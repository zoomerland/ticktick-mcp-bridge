import test from "node:test";
import assert from "node:assert/strict";
import { McpBridgeClient } from "../src/bridge-client.mjs";

test("sends JSON-RPC tools/call with bearer auth", async () => {
  const requests = [];
  const fetchImpl = async (_url, request) => {
    requests.push(request);
    return {
      ok: true,
      text: async () => JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        },
      }),
    };
  };

  const client = new McpBridgeClient({
    url: "https://example.test/mcp",
    bearerToken: "secret",
    fetchImpl,
  });
  const result = await client.callTool("ticktick_diagnostics", { includeTaskCounts: true });

  assert.deepEqual(result, { ok: true });
  assert.equal(requests[0].headers.Authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(requests[0].body).params, {
    name: "ticktick_diagnostics",
    arguments: { includeTaskCounts: true },
  });
});

test("throws on MCP tool error result", async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        isError: true,
        content: [{ type: "text", text: "missing auth" }],
      },
    }),
  });
  const client = new McpBridgeClient({ url: "http://local", fetchImpl });
  await assert.rejects(() => client.callTool("ticktick_today"), /missing auth/);
});
