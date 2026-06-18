const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8787/mcp";
const bearerToken = process.env.SMOKE_BEARER_TOKEN || process.env.APP_SHARED_SECRET || "";

async function rpc(method, params = undefined, id = 1) {
  const headers = { "Content-Type": "application/json" };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
}

console.log(JSON.stringify(await rpc("initialize", { protocolVersion: "2025-03-26" }, 1), null, 2));
const tools = await rpc("tools/list", {}, 2);
console.log(`tools: ${tools.result.tools.length}`);
console.log(tools.result.tools.map((tool) => tool.name).join("\n"));
