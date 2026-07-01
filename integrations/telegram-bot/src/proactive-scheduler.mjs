import { setTimeout as sleep } from "node:timers/promises";
import { buildProactiveReview, loadProactiveInputs } from "./secretary/proactive.mjs";

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function signature(review) {
  const { overdueCount, todayCount, inboxCount, inQuietHours, inCheckinHours } = review.reasons;
  return [overdueCount, todayCount, inboxCount, inQuietHours, inCheckinHours, hashText(review.text)].join(":");
}

export async function runProactiveOnce({ bridge, config, telegram, logger, state = {}, now = new Date() }) {
  const inputs = await loadProactiveInputs({ bridge, config });
  const review = buildProactiveReview({ ...inputs, now }, config);
  const chatId = config.telegram.proactiveChatId;
  const currentSignature = signature(review);

  if (!config.telegram.proactiveEnabled) {
    logger?.debug?.("Proactive review disabled.");
    return { ...review, sent: false, skipped: "disabled" };
  }
  if (!chatId) {
    logger?.warn?.("Proactive review enabled without TELEGRAM_PROACTIVE_CHAT_ID.");
    return { ...review, sent: false, skipped: "missing_chat_id" };
  }
  if (!review.shouldNotify) {
    return { ...review, sent: false, skipped: "no_notification_needed" };
  }
  if (state.lastProactiveSignature === currentSignature) {
    return { ...review, sent: false, skipped: "duplicate" };
  }

  await telegram.sendMessage(chatId, review.text);
  state.lastProactiveSignature = currentSignature;
  return { ...review, sent: true };
}

export async function startProactiveLoop(runtime) {
  const { config, logger, session } = runtime;
  const state = session?.getProactiveState?.() || {};
  while (true) {
    try {
      await runProactiveOnce({ ...runtime, state });
      session?.persist?.();
    } catch (error) {
      logger?.error?.(`Proactive review error: ${error.message}`);
    }
    await sleep(config.telegram.proactiveIntervalMs);
  }
}
