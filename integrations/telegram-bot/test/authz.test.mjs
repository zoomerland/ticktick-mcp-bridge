import test from "node:test";
import assert from "node:assert/strict";
import { authorizeUpdate } from "../src/authz.mjs";
import { loadConfig } from "../src/config.mjs";

function config(env = {}) {
  return loadConfig({ TELEGRAM_DRY_RUN: "true", ...env });
}

function update({ userId = 10, chatId = 10, chatType = "private" } = {}) {
  return {
    message: {
      text: "/today",
      from: { id: userId },
      chat: { id: chatId, type: chatType },
    },
  };
}

test("allows an allowlisted private user", () => {
  const result = authorizeUpdate(update(), config({ TELEGRAM_ALLOWED_USER_IDS: "10" }));
  assert.equal(result.ok, true);
});

test("denies users outside allowlist", () => {
  const result = authorizeUpdate(update({ userId: 11 }), config({ TELEGRAM_ALLOWED_USER_IDS: "10" }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "user_not_allowed");
});

test("denies group chats unless chat is allowlisted", () => {
  const denied = authorizeUpdate(
    update({ chatId: -100, chatType: "group" }),
    config({ TELEGRAM_ALLOWED_USER_IDS: "10" }),
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "chat_not_allowed");

  const allowed = authorizeUpdate(
    update({ chatId: -100, chatType: "group" }),
    config({ TELEGRAM_ALLOWED_USER_IDS: "10", TELEGRAM_ALLOWED_CHAT_IDS: "-100" }),
  );
  assert.equal(allowed.ok, true);
});
