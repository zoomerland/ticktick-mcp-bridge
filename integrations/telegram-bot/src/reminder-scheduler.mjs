import { setTimeout as sleep } from "node:timers/promises";
import { buildReminderText, loadUpcomingReminders } from "./secretary/reminders.mjs";

function reminderSignature(reminder) {
  return (reminder.items || [])
    .map((item) => `${item.task.id || item.task.title || "task"}@${item.dueMs}`)
    .join("|");
}

export function markReminderSent(state, reminder, now = new Date()) {
  state.sent ||= {};
  const stamp = now.toISOString();
  for (const item of reminder.items || []) {
    const key = `${item.task.id || item.task.title || "task"}@${item.dueMs}`;
    state.sent[key] = stamp;
  }
}

export async function runReminderOnce({
  bridge,
  config,
  telegram,
  logger,
  session,
  state = session?.getReminderState?.() || {},
  now = new Date(),
}) {
  const chatId = config.telegram.reminderChatId || config.telegram.proactiveChatId;
  if (!config.telegram.remindersEnabled) {
    logger?.debug?.("Reminder loop disabled.");
    return { sent: false, skipped: "disabled" };
  }
  if (!chatId) {
    logger?.warn?.("Reminder loop enabled without TELEGRAM_REMINDER_CHAT_ID or TELEGRAM_PROACTIVE_CHAT_ID.");
    return { sent: false, skipped: "missing_chat_id" };
  }

  const profile = session?.getProfile?.(String(chatId)) || {};
  const reminder = await loadUpcomingReminders({ bridge, config, profile, now });
  reminder.config = config;
  reminder.profile = profile;
  const unsent = (reminder.items || []).filter((item) => {
    const key = `${item.task.id || item.task.title || "task"}@${item.dueMs}`;
    return !state.sent?.[key];
  });

  if (!reminder.shouldNotify || unsent.length === 0) {
    return {
      ...reminder,
      sent: false,
      skipped: reminder.shouldNotify ? "duplicate" : "no_reminders",
      signature: reminderSignature(reminder),
    };
  }

  const filtered = {
    ...reminder,
    count: unsent.length,
    items: unsent,
    text: buildReminderText({
      items: unsent,
      leadMinutes: reminder.leadMinutes,
      config,
    }),
  };
  await telegram.sendMessage(chatId, filtered.text);
  markReminderSent(state, filtered, now);
  session?.persist?.();
  return { ...filtered, sent: true, signature: reminderSignature(filtered) };
}

export async function startReminderLoop(runtime) {
  const { config, logger, session } = runtime;
  const state = session?.getReminderState?.() || {};
  while (true) {
    try {
      await runReminderOnce({ ...runtime, state });
    } catch (error) {
      logger?.error?.(`Reminder loop error: ${error.message}`);
    }
    await sleep(config.telegram.reminderIntervalMs);
  }
}
