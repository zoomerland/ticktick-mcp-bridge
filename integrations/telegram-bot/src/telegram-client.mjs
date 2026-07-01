export class TelegramClient {
  constructor({ token, fetchImpl = fetch }) {
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async api(method, payload = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.description || `Telegram API ${method} failed`);
    }
    return body.result;
  }

  getUpdates({ offset, timeout, limit } = {}) {
    return this.api("getUpdates", {
      ...(offset ? { offset } : {}),
      ...(limit ? { limit } : {}),
      timeout,
      allowed_updates: ["message", "edited_message"],
    });
  }

  sendMessage(chatId, text) {
    return this.api("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
  }

  getFile(fileId) {
    return this.api("getFile", { file_id: fileId });
  }

  async downloadFileBytes(filePath, { maxBytes = 0 } = {}) {
    const response = await this.fetchImpl(`https://api.telegram.org/file/bot${this.token}/${filePath}`);
    if (!response.ok) {
      throw new Error("Telegram file download failed");
    }
    const contentLength = Number.parseInt(response.headers?.get?.("content-length") || "", 10);
    if (maxBytes && Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error("Telegram file is too large");
    }
    return readResponseBytes(response, maxBytes);
  }
}

async function readResponseBytes(response, maxBytes = 0) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (maxBytes && bytes.byteLength > maxBytes) {
      throw new Error("Telegram file is too large");
    }
    return bytes;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    total += chunk.byteLength;
    if (maxBytes && total > maxBytes) {
      await reader.cancel?.();
      throw new Error("Telegram file is too large");
    }
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function updateChatId(update) {
  return update.message?.chat?.id || update.edited_message?.chat?.id || null;
}

async function sendFailureReply({ telegram, chatId, logger }) {
  if (!chatId) return;
  try {
    await telegram.sendMessage(chatId, "Command failed. I acknowledged the update; check service logs before retrying.");
  } catch (error) {
    logger?.error?.(`Failed to send Telegram error reply: ${error.message}`);
  }
}

export async function pollOnce({ telegram, bridge, config, llmClient = null, rateLimiter, session, logger, offset = 0 }) {
  const updates = await telegram.getUpdates({
    offset,
    timeout: config.telegram.pollingTimeoutSeconds,
  });
  let nextOffset = offset;
  for (const update of updates) {
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    try {
      const { handleUpdate } = await import("./command-router.mjs");
      const reply = await handleUpdate(update, { bridge, config, llmClient, rateLimiter, session, telegram });
      if (reply.chatId) await telegram.sendMessage(reply.chatId, reply.text);
    } catch (error) {
      logger?.error?.(`Telegram update ${update.update_id} failed: ${error.message}`);
      await sendFailureReply({ telegram, chatId: updateChatId(update), logger });
    }
  }
  return nextOffset;
}
