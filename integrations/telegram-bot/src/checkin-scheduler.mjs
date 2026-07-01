import { setTimeout as sleep } from "node:timers/promises";
import { loadCheckin } from "./secretary/checkin.mjs";

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function hourInWindow(hour, window) {
  if (window.startHour === window.endHour) return true;
  return window.startHour > window.endHour
    ? hour >= window.startHour || hour < window.endHour
    : hour >= window.startHour && hour < window.endHour;
}

function windowState(config, now) {
  const hour = now.getHours();
  const inQuietHours = hourInWindow(hour, config.telegram.quietHours);
  const inCheckinHours = hourInWindow(hour, config.telegram.checkinHours);
  return { inQuietHours, inCheckinHours };
}

function signature(checkin) {
  return `${checkin.status}:${hashText(checkin.text)}`;
}

export async function runCheckinOnce({
  bridge,
  config,
  telegram,
  logger,
  session,
  state = session?.getCheckinState?.() || {},
  now = new Date(),
}) {
  const chatId = config.telegram.checkinChatId || config.telegram.proactiveChatId;
  if (!config.telegram.checkinEnabled) {
    logger?.debug?.("Check-in loop disabled.");
    return { sent: false, skipped: "disabled" };
  }
  if (!chatId) {
    logger?.warn?.("Check-in loop enabled without TELEGRAM_CHECKIN_CHAT_ID or TELEGRAM_PROACTIVE_CHAT_ID.");
    return { sent: false, skipped: "missing_chat_id" };
  }

  const windows = windowState(config, now);
  if (windows.inQuietHours) {
    return { sent: false, skipped: "quiet_hours", ...windows };
  }
  if (!windows.inCheckinHours) {
    return { sent: false, skipped: "outside_checkin_hours", ...windows };
  }

  const checkin = await loadCheckin({ bridge, config, now });
  const currentSignature = signature(checkin);
  if (state.lastCheckinSignature === currentSignature) {
    return { ...checkin, sent: false, skipped: "duplicate", ...windows };
  }

  await telegram.sendMessage(chatId, checkin.text);
  session?.setPendingCheckin?.(String(chatId), checkin.pending);
  state.lastCheckinSignature = currentSignature;
  state.lastCheckinAt = now.toISOString();
  session?.persist?.();
  return { ...checkin, sent: true, ...windows };
}

export async function startCheckinLoop(runtime) {
  const { config, logger, session } = runtime;
  const state = session?.getCheckinState?.() || {};
  while (true) {
    try {
      await runCheckinOnce({ ...runtime, state });
    } catch (error) {
      logger?.error?.(`Check-in loop error: ${error.message}`);
    }
    await sleep(config.telegram.checkinIntervalMs);
  }
}
