import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { McpBridgeClient } from "../src/bridge-client.mjs";
import { loadConfig, loadEnvWithFile } from "../src/config.mjs";
import { routeText } from "../src/command-router.mjs";
import { createLlmClient } from "../src/llm-client.mjs";
import { SessionStore } from "../src/session-store.mjs";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function ticktickDateMinutesFromNow(minutes) {
  const date = new Date(Date.now() + minutes * 60 * 1000);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:00+0000`;
}

function createMockBridge() {
  return {
    async callTool(name, args = {}) {
      if (name === "ticktick_diagnostics") {
        return { ok: true, checks: { auth_configured: true, inbox_endpoint: true } };
      }
      if (name === "ticktick_today") {
        return {
          summary: { overdue: 1, today: 3 },
          tasks: [
            { id: "task-plan", projectId: "project-work", title: "Review day plan", projectName: "Work", priority: 3, dueBucket: "today" },
            { id: "task-focus", projectId: "project-work", title: "Start focused block", projectName: "Work", priority: 5, dueBucket: "today", dueDate: ticktickDateMinutesFromNow(35) },
            { id: "task-inbox", projectId: "inbox", title: "Clarify one loose inbox item", projectName: "Inbox", priority: 0, dueBucket: "overdue" },
          ],
        };
      }
      if (name === "ticktick_overdue") {
        return {
          tasks: [
            { id: "task-inbox", projectId: "inbox", title: "Clarify one loose inbox item", projectName: "Inbox", priority: 0, dueBucket: "overdue" },
          ],
        };
      }
      if (name === "ticktick_list_projects") {
        return [
          { id: "inbox", name: "Inbox", isInbox: true },
          { id: "project-work", name: "Work" },
          { id: "project-personal", name: "Personal" },
          { id: "project-health", name: "Health" },
        ];
      }
      if (name === "ticktick_inbox") {
        return [{ title: "Clarify one loose inbox item", projectName: "Inbox", priority: 0 }];
      }
      if (name === "ticktick_search_tasks") {
        return {
          tasks: [
            { title: `Mock candidate for ${args.query}`, projectName: "Work", priority: 0 },
          ],
        };
      }
      if (name === "ticktick_find_task_candidates") {
        return {
          tasks: [
            { id: "task-focus", projectId: "project-work", title: "Start focused block", projectName: "Work" },
          ],
          decision: {
            status: "single_candidate",
            canAct: true,
            taskId: "task-focus",
            projectId: "project-work",
          },
        };
      }
      if (name === "ticktick_complete_task_safe") {
        return { acted: true, projectId: args.projectId, taskId: args.taskId };
      }
      if (name === "ticktick_update_task") {
        return { id: args.taskId, updated: true };
      }
      if (name === "ticktick_create_task") {
        return { id: "task-created", title: args.title };
      }
      return { tasks: [] };
    },
  };
}

function buildConfig() {
  const fileAndProcessEnv = loadEnvWithFile(process.env, ".env");
  const allowChatWrites = fileAndProcessEnv.TELEGRAM_LLM_CHAT_ALLOW_WRITES === "true";
  return loadConfig({
    ...fileAndProcessEnv,
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: fileAndProcessEnv.TELEGRAM_ALLOWED_USER_IDS || "local-llm-chat",
    TELEGRAM_LLM_ENABLED: "true",
    TELEGRAM_CONFIRM_WRITES: allowChatWrites ? fileAndProcessEnv.TELEGRAM_CONFIRM_WRITES || "true" : "false",
    TELEGRAM_MAX_RESULTS: fileAndProcessEnv.TELEGRAM_MAX_RESULTS || "5",
  });
}

function createBridge(config, mode) {
  if (mode === "live") {
    return new McpBridgeClient({
      url: config.bridge.url,
      bearerToken: config.bridge.bearerToken,
      timeoutMs: config.bridge.timeoutMs,
    });
  }
  return createMockBridge();
}

function printIntro(config, bridgeMode) {
  console.log([
    "TickTick Telegram LLM chat test",
    `provider: ${config.llm.provider}`,
    `model: ${config.llm.model}`,
    `bridge: ${bridgeMode}`,
    "",
    "Type free text, /help, /today, /add something, /cancel, or /exit.",
    "Default bridge mode is mock and does not write to TickTick.",
    "Use TELEGRAM_LLM_CHAT_BRIDGE=live only for an explicit live MCP smoke.",
    "Confirmed writes stay disabled unless TELEGRAM_LLM_CHAT_ALLOW_WRITES=true.",
    "",
  ].join("\n"));
}

const config = buildConfig();
if (config.errors.length) {
  console.error(`Invalid config: ${config.errors.join("; ")}`);
  process.exit(1);
}

const llmClient = createLlmClient(config.llm);
const bridgeMode = process.env.TELEGRAM_LLM_CHAT_BRIDGE === "live" ? "live" : "mock";
const bridge = createBridge(config, bridgeMode);
const session = new SessionStore();
const principal = { userId: "local-llm-chat", chatId: "local-llm-chat" };
const rl = createInterface({ input, output });

printIntro(config, bridgeMode);

try {
  output.write("> ");
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) {
      output.write("> ");
      continue;
    }
    if (["/exit", "exit", "quit", "/quit"].includes(line.toLowerCase())) {
      break;
    }

    try {
      const result = await routeText(line, {
        bridge,
        config,
        llmClient,
        session,
        principal,
      });
      const meta = [
        result.kind ? `kind=${result.kind}` : "",
        result.routedBy ? `routedBy=${result.routedBy}` : "",
        result.tool ? `tool=${result.tool}` : "",
      ].filter(Boolean).join(" ");
      if (meta) console.log(`[${meta}]`);
      console.log(result.text || "(empty response)");
      if (result.error) console.log(`[llm-error] ${result.error}`);
    } catch (error) {
      console.error(`[error] ${error.message || String(error)}`);
    }
    output.write("> ");
  }
} finally {
  rl.close();
}
