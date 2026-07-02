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
  "In chat mode you do not have live TickTick task data unless the user provides it.",
  "Do not say you will check, open, update, or inspect TickTick from chat mode.",
  "Do not claim that you changed TickTick. If action is needed, suggest a concrete next command or ask one concise question.",
].join("\n");

const NARRATOR_SYSTEM = [
  "/no_think",
  "You are the human-facing voice of a Telegram TickTick secretary.",
  "You receive the user's original message, the executor command that was run, and the deterministic tool reply.",
  "Return exactly one JSON object and nothing else.",
  'Shape: {"text":"natural user-facing reply"}.',
  "Rewrite the deterministic reply into a clear, natural answer in the same language as the user.",
  "For Russian replies, use informal second-person singular unless the user clearly uses formal address.",
  "Do not expose JSON, raw field names, ids, or implementation details unless the user explicitly asks for them.",
  "Preserve the important facts: task titles, list/project names, due dates, overdue/today/next labels, and priority.",
  "If a summary count conflicts with the listed tasks, trust the listed tasks and avoid unsupported exact counts.",
  "If there are overdue tasks, say so plainly and helpfully.",
  "Do not invent tasks, dates, counts, or actions.",
  "Do not claim that you changed TickTick.",
  "Never copy the deterministic reply verbatim.",
  "Keep it concise and easy to scan.",
].join("\n");

function parseJsonObject(text) {
  const value = String(text || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(value);
}

async function jsonChatWithRetry({ llmClient, messages, model, options, label, validate = null }) {
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
      const parsed = parseJsonObject(response.content);
      if (validate) validate(parsed);
      return parsed;
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

function nowMs() {
  return Date.now();
}

function elapsedMs(startedAt) {
  return Math.max(0, nowMs() - startedAt);
}

function shouldNarrateExecutorResult(result) {
  if (!result) return false;
  if (result.kind !== "bridge") return false;
  return Boolean(result.text);
}

function normalizeContainmentText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractTaskTitleFromLine(line) {
  return String(line || "")
    .replace(/^-\s*/, "")
    .replace(/\s+priority\s+(?:high|medium|low|none)\s*$/i, "")
    .replace(/\s+due\s+\S+(?:\s|$).*$/i, "")
    .replace(/\s+\[[^\]]+\]\s*$/i, "")
    .trim();
}

function listedTaskTitles(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => /^-\s+\S/.test(line))
    .map(extractTaskTitleFromLine)
    .filter((title) => title.length >= 3);
}

function validateNarratorPreservesTasks(narratedText, deterministicText) {
  const requiredTitles = listedTaskTitles(deterministicText);
  if (!requiredTitles.length) return;
  const normalizedNarrated = normalizeContainmentText(narratedText);
  const missing = requiredTitles.filter((title) => !normalizedNarrated.includes(normalizeContainmentText(title)));
  if (missing.length) {
    throw new Error(`narrator reply omitted task titles: ${missing.join(", ")}`);
  }
}

function validateNarratorReply(value, { deterministicText = "" } = {}) {
  if (!value || typeof value.text !== "string" || !value.text.trim()) {
    throw new Error("narrator reply must contain a non-empty text string");
  }
  const text = value.text.trim();
  if (/\bsummary\s*:/i.test(text) || /\{["']?(overdue|today|next_7_days|later|no_due_date)["']?\s*:/i.test(text)) {
    throw new Error("narrator reply still exposes raw summary fields");
  }
  if (/^Today and overdue\b/i.test(text)) {
    throw new Error("narrator reply copied the deterministic heading");
  }
  validateNarratorPreservesTasks(text, deterministicText);
}

function normalizeNarratedText(text) {
  return String(text || "")
    .trim()
    .replace(/У вас/g, "У тебя")
    .replace(/у вас/g, "у тебя");
}

async function narrateExecutorResult({ text, command, commandArgsText, result, config, llmClient }) {
  const reply = await jsonChatWithRetry({
    llmClient,
    model: config.llm.chatModel,
    label: "narrator reply",
    validate: (value) => validateNarratorReply(value, { deterministicText: result.text }),
    options: {
      temperature: config.llm.chatTemperature,
      top_p: 0.9,
      num_ctx: config.llm.contextTokens,
      num_predict: config.llm.chatMaxTokens,
    },
    messages: [
      { role: "system", content: NARRATOR_SYSTEM },
      {
        role: "user",
        content: [
          `Original user message:\n${text}`,
          `Executor command:\n/${command}${commandArgsText ? ` ${commandArgsText}` : ""}`,
          `Deterministic reply:\n${result.text}`,
        ].join("\n\n"),
      },
    ],
  });
  const narrated = normalizeNarratedText(reply.text);
  return narrated || result.text;
}

export async function routeLlmText(
  text,
  { bridge, config, llmClient, executeCommand },
) {
  if (!config.llm.enabled || !llmClient) return null;
  const startedAt = nowMs();
  const timings = {};

  try {
    const routerStartedAt = nowMs();
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
    timings.llmRouterMs = elapsedMs(routerStartedAt);

    const mode = normalizeMode(router.mode);
    if (mode === "chat") {
      const chatStartedAt = nowMs();
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
      timings.llmChatMs = elapsedMs(chatStartedAt);
      return {
        kind: "llm_chat",
        text: reply.content || "I am here. Tell me what you want to sort out first.",
        _timings: {
          ...timings,
          llmTotalMs: elapsedMs(startedAt),
        },
      };
    }

    const executorStartedAt = nowMs();
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
    timings.llmExecutorMs = elapsedMs(executorStartedAt);
    const command = normalizeCommand(planned.command);
    if (!command) {
      throw new Error("LLM executor returned an unsupported command");
    }
    const commandArgsText = String(planned.argsText || "").trim();
    const commandStartedAt = nowMs();
    const result = {
      ...(await executeCommand(commandText({ command, argsText: commandArgsText }))),
      routedBy: "llm_executor",
    };
    timings.executorCommandMs = elapsedMs(commandStartedAt);
    Object.assign(timings, result._timings || {});
    if (shouldNarrateExecutorResult(result)) {
      try {
        const narratorStartedAt = nowMs();
        const narratedText = await narrateExecutorResult({
          text,
          command,
          commandArgsText,
          result,
          config,
          llmClient,
        });
        timings.llmNarratorMs = elapsedMs(narratorStartedAt);
        return {
          ...result,
          text: narratedText,
          narratedBy: "llm_narrator",
          _timings: {
            ...timings,
            llmTotalMs: elapsedMs(startedAt),
          },
        };
      } catch {
        return {
          ...result,
          _timings: {
            ...timings,
            llmTotalMs: elapsedMs(startedAt),
          },
        };
      }
    }
    return {
      ...result,
      _timings: {
        ...timings,
        llmTotalMs: elapsedMs(startedAt),
      },
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
        _timings: {
          ...timings,
          llmTotalMs: elapsedMs(startedAt),
        },
      };
    }
    return null;
  }
}

export const llmAgentInternals = {
  parseJsonObject,
  normalizeCommand,
  commandText,
  shouldNarrateExecutorResult,
  validateNarratorReply,
  validateNarratorPreservesTasks,
  listedTaskTitles,
  normalizeNarratedText,
};
