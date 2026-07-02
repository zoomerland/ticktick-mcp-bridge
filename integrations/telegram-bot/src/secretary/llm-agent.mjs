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

const TASK_LIST_TOOLS = new Set([
  "ticktick_today",
  "ticktick_overdue",
  "ticktick_inbox",
  "ticktick_search_tasks",
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

function directChatReason(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  const actionIntent = /\b(show|list|find|search|add|create|complete|done|postpone|move|delete|check|inspect|open|update|today|overdue|reminder|reminders|project|projects|inbox)\b|покажи|найди|поиск|добавь|создай|запиши|заверши|закрой|готово|перенеси|удали|проверь|сегодня|просроч|напоминан|проект|инбокс|входящ|显示|顯示|展示|列出|查看|看看|睇|找|搵|搜索|搜尋|查询|查詢|添加|新增|新建|创建|創建|完成|做完|推迟|推遲|延后|延後|移动|移動|删除|刪除|检查|檢查|打开|打開|更新|逾期|过期|過期|提醒|项目|項目|收件箱|任务|任務/i;
  if (actionIntent.test(value)) return "";
  const chatIntent = /\b(overwhelmed|anxious|stuck|tired|stressed|stressful|worried|motivat|support|think with me|help me think|help me decide|prioriti[sz]e|priority tradeoff)\b|тяжело|устал|устала|перегруж|тревож|застрял|застряла|поддерж|мотивац|давай подума|помоги подум|помоги реш|приоритет|压力大|壓力大|很累|好攰|累了|攰|焦虑|焦慮|担心|擔心|卡住|支持|鼓励|鼓勵|动力|動力|陪我想|陪我諗|帮我想|幫我諗|帮我决定|幫我決定|优先级|優先級|優先次序|取舍|取捨/i;
  if (!chatIntent.test(value)) return "";
  return "direct_chat_intent";
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

function localeForText(text) {
  const value = String(text || "");
  if (/[А-Яа-яЁё]/.test(value)) return "ru";
  if (/[\u3400-\u9fff]/.test(value)) {
    return /[個這裡麼嗎過優級項顯尋資訊選擇壓擔慮幫諗攰務計劃檢刪創遲後動開閉]/.test(value)
      ? "zhHant"
      : "zhHans";
  }
  return "en";
}

function taskListHeading(line, locale) {
  const normalized = String(line || "").trim().toLowerCase();
  if (normalized === "today and overdue") {
    if (locale === "ru") return "Вот что висит на сегодня и в просроченном:";
    if (locale === "zhHans") return "今天和逾期任务：";
    if (locale === "zhHant") return "今日同逾期事項：";
    return "Here is what I found for today and overdue:";
  }
  if (normalized === "overdue") return { ru: "Просрочено", zhHans: "逾期", zhHant: "逾期" }[locale] || "Overdue";
  if (normalized === "today") return { ru: "Сегодня", zhHans: "今天", zhHant: "今日" }[locale] || "Today";
  if (normalized === "next 7 days") return { ru: "Ближайшие 7 дней", zhHans: "未来 7 天", zhHant: "未來 7 日" }[locale] || "Next 7 days";
  if (normalized === "later") return { ru: "Позже", zhHans: "稍后", zhHant: "稍後" }[locale] || "Later";
  if (normalized === "no due date") return { ru: "Без даты", zhHans: "无日期", zhHant: "無日期" }[locale] || "No due date";
  if (normalized === "inbox") return { ru: "Входящие", zhHans: "收件箱", zhHant: "收件箱" }[locale] || "Inbox";
  if (normalized === "search results") return { ru: "Результаты поиска", zhHans: "搜索结果", zhHant: "搜尋結果" }[locale] || "Search results";
  return line;
}

function priorityText(priority, locale) {
  const normalized = String(priority || "").toLowerCase();
  if (!normalized || normalized === "none") return "";
  if (locale === "ru") {
    if (normalized === "high") return "высокий приоритет";
    if (normalized === "medium") return "средний приоритет";
    if (normalized === "low") return "низкий приоритет";
  }
  if (locale === "zhHans") {
    if (normalized === "high") return "高优先级";
    if (normalized === "medium") return "中优先级";
    if (normalized === "low") return "低优先级";
  }
  if (locale === "zhHant") {
    if (normalized === "high") return "高優先級";
    if (normalized === "medium") return "中優先級";
    if (normalized === "low") return "低優先級";
  }
  if (locale === "en") return `${normalized} priority`;
  return `${normalized} priority`;
}

function dueText(dueDate, locale) {
  const raw = String(dueDate || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  const value = match ? `${match[1]}${match[2] ? ` ${match[2]}` : ""}` : raw;
  if (locale === "ru") return `срок ${value}`;
  if (locale === "zhHans") return `截止 ${value}`;
  if (locale === "zhHant") return `期限 ${value}`;
  return `due ${value}`;
}

function formatTaskLineForUser(line, locale) {
  let text = String(line || "").replace(/^-\s*/, "").trim();
  let priority = "";
  text = text.replace(/\s+priority\s+([a-z]+)\s*$/i, (_match, value) => {
    priority = value;
    return "";
  }).trim();

  let due = "";
  text = text.replace(/\s+due\s+(\S+)\s*$/i, (_match, value) => {
    due = value;
    return "";
  }).trim();

  let project = "";
  text = text.replace(/\s+\[([^\]]+)\]\s*$/i, (_match, value) => {
    project = value;
    return "";
  }).trim();

  const details = [project, dueText(due, locale), priorityText(priority, locale)].filter(Boolean);
  return details.length ? `- ${text} — ${details.join(", ")}` : `- ${text}`;
}

export function formatTaskListForUser(result, userText) {
  if (!TASK_LIST_TOOLS.has(result?.tool)) return "";
  const lines = String(result?.text || "").split(/\r?\n/);
  const hasTasks = lines.some((line) => /^-\s+\S/.test(line));
  const hasEmptyMessage = lines.some((line) => /^No matching open tasks\.$/i.test(line.trim()));
  if (!hasTasks && !hasEmptyMessage) return "";

  const locale = localeForText(userText);
  const output = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^summary\s*:/i.test(line)) continue;
    if (/^-\s+\S/.test(line)) {
      output.push(formatTaskLineForUser(line, locale));
    } else if (/^No matching open tasks\.$/i.test(line)) {
      output.push({
        ru: "Открытых задач не нашёл.",
        zhHans: "没有找到打开的任务。",
        zhHant: "沒有找到未完成任務。",
      }[locale] || "No matching open tasks.");
    } else {
      output.push(taskListHeading(line, locale));
    }
  }
  return output.join("\n").trim();
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
    const directReason = directChatReason(text);
    let mode = "chat";
    if (directReason) {
      timings.llmRouterSkipped = directReason;
    } else {
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
      mode = normalizeMode(router.mode);
    }
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
    const taskListText = formatTaskListForUser(result, text);
    if (taskListText) {
      return {
        ...result,
        text: taskListText,
        formattedBy: "deterministic_task_list",
        _timings: {
          ...timings,
          llmTotalMs: elapsedMs(startedAt),
        },
      };
    }
    if (shouldNarrateExecutorResult(result)) {
      const narratorStartedAt = nowMs();
      try {
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
        timings.llmNarratorMs = elapsedMs(narratorStartedAt);
        timings.llmNarratorStatus = "failed";
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
  formatTaskListForUser,
  listedTaskTitles,
  normalizeNarratedText,
};
