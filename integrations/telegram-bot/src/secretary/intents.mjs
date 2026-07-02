const COMMAND_ALIASES = new Map([
  ["start", "start"],
  ["help", "help"],
  ["помощь", "help"],
  ["старт", "start"],
  ["diagnostics", "diagnostics"],
  ["diag", "diagnostics"],
  ["диагностика", "diagnostics"],
  ["checkin", "checkin"],
  ["check-in", "checkin"],
  ["brief", "brief"],
  ["plan", "brief"],
  ["план", "brief"],
  ["день", "brief"],
  ["today", "today"],
  ["сегодня", "today"],
  ["overdue", "overdue"],
  ["просрочено", "overdue"],
  ["просрочка", "overdue"],
  ["projects", "projects"],
  ["проекты", "projects"],
  ["inbox", "inbox"],
  ["инбокс", "inbox"],
  ["входящие", "inbox"],
  ["search", "search"],
  ["find", "search"],
  ["поиск", "search"],
  ["найти", "search"],
  ["add", "add"],
  ["добавить", "add"],
  ["записать", "add"],
  ["capture", "capture"],
  ["complete", "complete"],
  ["готово", "complete"],
  ["закрыть", "complete"],
  ["postpone-today", "postpone-today"],
  ["перенести-сегодня", "postpone-today"],
  ["profile", "profile"],
  ["профиль", "profile"],
  ["routes", "routes"],
  ["маршруты", "routes"],
  ["set-route", "set-route"],
  ["настроить-маршрут", "set-route"],
  ["set-checkins", "set-checkins"],
  ["checkins", "set-checkins"],
  ["часы-проверок", "set-checkins"],
  ["reminders", "reminders"],
  ["напоминания", "reminders"],
  ["proactive", "proactive"],
  ["проверка", "proactive"],
  ["confirm", "confirm"],
  ["подтвердить", "confirm"],
  ["cancel", "cancel"],
  ["отмена", "cancel"],
  ["стоп", "cancel"],
]);

const READ_ONLY_INTENTS = [
  {
    command: "checkin",
    pattern: /\b(check[- ]?in|check my day|how is my day|how's my day|how am i doing|state of my day)\b/i,
  },
  {
    command: "brief",
    pattern: /\b(day plan|plan for today|daily brief|what is my plan)\b|план.*(дня|сегодня)|что.*(по плану|на сегодня)|как.*(план|день)|今天.*(计划|安排)|今日.*(計劃|安排)|每日简报|每日簡報/i,
  },
  {
    command: "today",
    pattern: /\b(what.*today|show.*today|today's tasks|today tasks|what tasks|show.*tasks|list.*tasks|my tasks|what do i have)\b|что.*сегодня|покажи.*сегодня|дела.*сегодня|задачи.*сегодня|какие.*задач|что.*задач|покажи.*задач|список.*задач|мои.*задач|今天.*(任务|待办)|任务.*今天|有.*任务|我的.*任务|看看.*任务|查看.*任务|今日.*(任務|待辦)|任務.*今日|有咩.*任務|我.*任務|睇.*任務/i,
  },
  {
    command: "reminders",
    pattern: /\b(next task|next thing|upcoming|remind me what|what is next)\b|что.*(дальше|следующее)|ближайш.*(дел|задач|напомин)|что.*скоро|напомни.*(что|дел)|下一步|接下来|接下來|提醒|稍后|稍後|即将|即將/i,
  },
  {
    command: "overdue",
    pattern: /\b(overdue|late tasks|what is late)\b|просроч|что.*опоздал|что.*зависло|逾期|过期|過期|超时|超時|拖延/i,
  },
  {
    command: "inbox",
    pattern: /\b(inbox|triage)\b|инбокс|входящ|разобрать.*задач|收件箱|待整理/i,
  },
  {
    command: "proactive",
    pattern: /\b(free time|what should i do|check my day|how is my day)\b|свободн.*врем|окно.*врем|чем.*заняться|что.*делать|проверь.*(день|план)/i,
  },
  {
    command: "profile",
    pattern: /\b(my profile|settings)\b|мой профиль|настройки|как ты меня знаешь|设置|設定|我的资料|我的資料/i,
  },
];

const EXACT_CANCEL_RE = /^(cancel|stop|never mind|forget it|отмена|стоп|не надо|забудь)$/i;

export function normalizeCommandName(command) {
  const normalized = String(command || "").trim().toLowerCase().replace(/_/g, "-");
  return COMMAND_ALIASES.get(normalized) || normalized;
}

export function resolveNaturalIntent(text, { hasPending = false } = {}) {
  const value = String(text || "").trim();
  if (!value) return null;

  if (EXACT_CANCEL_RE.test(value)) {
    return { command: "cancel", argsText: "" };
  }

  if (hasPending) return null;

  for (const intent of READ_ONLY_INTENTS) {
    if (intent.pattern.test(value)) {
      return { command: intent.command, argsText: "" };
    }
  }

  return null;
}
