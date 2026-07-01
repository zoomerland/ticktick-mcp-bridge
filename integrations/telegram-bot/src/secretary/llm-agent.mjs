const EXECUTABLE_COMMANDS = new Set([
  "help",
  "diagnostics",
  "checkin",
  "brief",
  "today",
  "overdue",
  "projects",
  "inbox",
  "search",
  "add",
  "complete",
  "postpone-today",
  "profile",
  "routes",
  "reminders",
  "proactive",
  "cancel",
]);

const EXECUTOR_SYSTEM = [
  "/no_think",
  "You are a strict executor planner for a Telegram TickTick secretary.",
  "Return exactly one JSON object and nothing else.",
  'Shape: {"command":"command-name","argsText":"optional text"}.',
  `Allowed command names: ${Array.from(EXECUTABLE_COMMANDS).join(", ")}.`,
  "Do not invent new commands. Do not output raw HTTP, MCP, REST, JSON-RPC, method, path, url, body, or headers.",
  "Use read-only commands for viewing, searching, briefing, reminders, profile, routes, projects, today, overdue, inbox, and check-ins.",
  "Use add, complete, postpone-today, confirm, or cancel only when the user clearly asks for that flow.",
  "Writes are safe because the existing bot router creates drafts and waits for explicit /confirm where required.",
  "Never emit confirm. The user must send the literal /confirm command for write execution.",
  "If the user asks to just talk, discuss, choose priorities, or think together, this executor should not be used.",
].join("\n");

const ROUTER_SYSTEM = [
  "/no_think",
  "You route a Telegram message for a TickTick secretary.",
  "Return exactly one JSON object and nothing else.",
  'Shape: {"mode":"chat"|"execute","reason":"short reason"}.',
  "Use execute when the user clearly asks to view, search, create, complete, postpone, confirm, cancel, inspect, or run a supported TickTick secretary command.",
  "Use chat when the user wants discussion, support, motivation, prioritization advice, or ambiguous planning without an immediate TickTick operation.",
  "Never claim that TickTick was changed.",
].join("\n");

const CHAT_SYSTEM = [
  "You are a warm but practical Telegram secretary for personal TickTick planning.",
  "Talk naturally and briefly.",
  "You may discuss priorities, concerns, tradeoffs, and next steps.",
  "Do not claim that you changed TickTick. If action is needed, suggest a concrete next command or ask one concise question.",
].join("\n");

function parseJsonObject(text) {
  const value = String(text || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(value);
}

async function jsonChatWithRetry({ llmClient, messages, model, options, label }) {
  let previous = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const requestMessages = previous
      ? [
        ...messages,
        { role: "assistant", content: previous.content.slice(0, 1000) },
        { role: "user", content: `Invalid ${label}: ${previous.error}. Return exactly valid JSON only.` },
      ]
      : messages;
    const response = await llmClient.chat({
      model,
      messages: requestMessages,
      format: "json",
      think: false,
      options,
    });
    try {
      return parseJsonObject(response.content);
    } catch (error) {
      previous = { content: response.content, error: error.message };
    }
  }
  throw new Error(`LLM returned invalid ${label}`);
}

function normalizeMode(value) {
  const mode = String(value || "").toLowerCase();
  return mode === "execute" ? "execute" : "chat";
}

function normalizeCommand(command) {
  const normalized = String(command || "").trim().toLowerCase().replace(/_/g, "-");
  return EXECUTABLE_COMMANDS.has(normalized) ? normalized : "";
}

function commandText({ command, argsText }) {
  const args = String(argsText || "").trim();
  return args ? `/${command} ${args}` : `/${command}`;
}

function executorOptions(config) {
  return {
    temperature: 0,
    top_p: 0.9,
    num_ctx: config.llm.contextTokens,
    num_predict: config.llm.executorMaxTokens,
  };
}

export async function routeLlmText(
  text,
  { bridge, config, llmClient, executeCommand },
) {
  if (!config.llm.enabled || !llmClient) return null;

  try {
    const router = await jsonChatWithRetry({
      llmClient,
      model: config.llm.routerModel,
      label: "router decision",
      options: executorOptions(config),
      messages: [
        { role: "system", content: ROUTER_SYSTEM },
        { role: "user", content: text },
      ],
    });

    const mode = normalizeMode(router.mode);
    if (mode === "chat") {
      const reply = await llmClient.chat({
        model: config.llm.chatModel,
        think: config.llm.chatThink,
        options: {
          temperature: config.llm.chatTemperature,
          top_p: 0.9,
          num_ctx: config.llm.contextTokens,
          num_predict: config.llm.chatMaxTokens,
        },
        messages: [
          { role: "system", content: CHAT_SYSTEM },
          { role: "user", content: text },
        ],
      });
      return {
        kind: "llm_chat",
        text: reply.content || "I am here. Tell me what you want to sort out first.",
      };
    }

    const planned = await jsonChatWithRetry({
      llmClient,
      model: config.llm.executorModel,
      label: "executor command",
      options: executorOptions(config),
      messages: [
        { role: "system", content: EXECUTOR_SYSTEM },
        { role: "user", content: text },
      ],
    });
    const command = normalizeCommand(planned.command);
    if (!command) {
      throw new Error("LLM executor returned an unsupported command");
    }
    return {
      ...(await executeCommand(commandText({ command, argsText: planned.argsText }))),
      routedBy: "llm_executor",
    };
  } catch (error) {
    if (config.llm.failClosed) {
      return {
        kind: "llm_unavailable",
        text: [
          "LLM mode is unavailable or returned an unsafe plan.",
          "Use /help for deterministic commands, or try again after checking the bot logs.",
        ].join("\n"),
        error: error.message,
      };
    }
    return null;
  }
}

export const llmAgentInternals = {
  parseJsonObject,
  normalizeCommand,
  commandText,
};
