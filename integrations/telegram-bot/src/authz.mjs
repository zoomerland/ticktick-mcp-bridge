export function extractPrincipal(update) {
  const message = update.message || update.edited_message || update.callback_query?.message || null;
  const from = update.message?.from || update.edited_message?.from || update.callback_query?.from || null;
  const chat = message?.chat || null;

  return {
    userId: from?.id === undefined ? "" : String(from.id),
    chatId: chat?.id === undefined ? "" : String(chat.id),
    chatType: chat?.type || "",
    username: from?.username || "",
  };
}

export function authorizeUpdate(update, config) {
  const principal = extractPrincipal(update);
  const allowedUserIds = config.telegram.allowedUserIds;
  const allowedChatIds = config.telegram.allowedChatIds;

  if (!principal.userId) return { ok: false, reason: "missing_user", principal };
  if (allowedUserIds.size > 0 && !allowedUserIds.has(principal.userId)) {
    return { ok: false, reason: "user_not_allowed", principal };
  }

  if (principal.chatType && principal.chatType !== "private") {
    if (allowedChatIds.size === 0 || !allowedChatIds.has(principal.chatId)) {
      return { ok: false, reason: "chat_not_allowed", principal };
    }
  }

  if (allowedChatIds.size > 0 && !allowedChatIds.has(principal.chatId)) {
    return { ok: false, reason: "chat_not_allowed", principal };
  }

  return { ok: true, reason: "allowed", principal };
}
