import { pathToFileURL } from "node:url";
import { McpBridgeClient } from "../src/bridge-client.mjs";
import { getTasks } from "../src/formatters.mjs";
import { loadConfig, loadEnvWithFile } from "../src/config.mjs";

const REQUIRED_TOOLS = [
  "ticktick_diagnostics",
  "ticktick_today",
  "ticktick_inbox",
  "ticktick_search_tasks",
];

function present(value) {
  return value ? "set" : "missing";
}

function bridgeTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function toolNames(listResult) {
  return (listResult?.tools || [])
    .map((tool) => tool.name)
    .filter(Boolean);
}

function diagnosticsSummary(data) {
  const checks = data?.checks || {};
  return [
    `diagnostics.ok: ${data?.ok ?? "unknown"}`,
    `auth_configured: ${checks.auth_configured ?? "unknown"}`,
    `inbox_endpoint: ${checks.inbox_endpoint ?? "unknown"}`,
  ];
}

export async function runBridgeReadOnlySmoke({ config, searchQuery = "", fetchImpl = fetch } = {}) {
  const bridge = new McpBridgeClient({
    url: config.bridge.url,
    bearerToken: config.bridge.bearerToken,
    timeoutMs: config.bridge.timeoutMs,
    fetchImpl,
  });

  const lines = [
    "Bridge read-only smoke",
    `bridgeUrl: ${bridgeTarget(config.bridge.url)}`,
    `bridgeBearerToken: ${present(config.bridge.bearerToken)}`,
  ];

  await bridge.initialize();
  lines.push("initialize: ok");

  const listResult = await bridge.listTools();
  const names = toolNames(listResult);
  const missing = REQUIRED_TOOLS.filter((name) => !names.includes(name));
  lines.push(`tools: ${names.length}`);
  lines.push(`requiredTools: ${missing.length ? `missing ${missing.join(", ")}` : "ok"}`);
  if (missing.length) {
    return {
      ok: false,
      text: lines.join("\n"),
    };
  }

  const diagnostics = await bridge.callTool("ticktick_diagnostics", { includeTaskCounts: true });
  lines.push(...diagnosticsSummary(diagnostics));

  const today = await bridge.callTool("ticktick_today", { includeNext7Days: false });
  lines.push(`todayTasks: ${getTasks(today).length}`);

  const inbox = await bridge.callTool("ticktick_inbox", { limit: config.telegram.maxResults, openOnly: true });
  lines.push(`inboxTasks: ${getTasks(inbox).length}`);

  if (searchQuery) {
    const search = await bridge.callTool("ticktick_search_tasks", {
      query: searchQuery,
      limit: config.telegram.maxResults,
      openOnly: true,
    });
    lines.push(`searchTasks: ${getTasks(search).length}`);
  } else {
    lines.push("searchTasks: skipped");
  }

  lines.push("writesCalled: false");
  return {
    ok: true,
    text: lines.join("\n"),
  };
}

export async function main(env = process.env) {
  const loadedEnv = loadEnvWithFile(env);
  const config = loadConfig({ ...loadedEnv, TELEGRAM_DRY_RUN: "true" });
  const result = await runBridgeReadOnlySmoke({
    config,
    searchQuery: loadedEnv.BRIDGE_SMOKE_SEARCH_QUERY || "",
  });
  console.log(result.text);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error("Bridge read-only smoke failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
}
