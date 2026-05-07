const express = require("express");
const env = require("../config/env");
const { switchToBot } = require("../services/session");
const {
  answerCallbackQuery,
  completeHandoffNotification,
  connectTelegramChatWithCode,
  editMessageReplyMarkup,
  sendTelegramMessage,
} = require("../services/telegram");
const logger = require("../utils/logger");

const router = express.Router();

function verifyTelegramSecret(req, res, next) {
  const expected = String(env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (!expected) return next();
  const provided = String(req.get("x-telegram-bot-api-secret-token") || req.query.secret || "").trim();
  if (provided !== expected) {
    return res.status(403).send("Forbidden");
  }
  return next();
}

function chatTitleFromMessage(message = {}) {
  const chat = message.chat || {};
  return String(chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "").trim();
}

function parseConnectCode(text) {
  const value = String(text || "").trim();
  const connectMatch = value.match(/^\/?(?:connect|חבר)\s+(TG-[A-Z0-9]{4}-[A-Z0-9]{4})$/i);
  if (connectMatch) return connectMatch[1];
  const directMatch = value.match(/^(TG-[A-Z0-9]{4}-[A-Z0-9]{4})$/i);
  return directMatch ? directMatch[1] : "";
}

function buildConnectPrompt() {
  return [
    "כדי לחבר את הקבוצה להתראות הנציג של העסק, שלחו כאן את קוד החיבור שקיבלתם בבוט הניהול.",
    "",
    "לדוגמה:",
    "TG-ABCD-1234",
    "",
    "עד שהקוד לא יאושר, הקבוצה הזו לא תקבל התראות.",
  ].join("\n");
}

function botWasAddedToChat(message = {}) {
  const newMembers = Array.isArray(message.new_chat_members) ? message.new_chat_members : [];
  return newMembers.some((member) => member?.is_bot);
}

async function handleMessage(message) {
  const chatId = String(message?.chat?.id || "").trim();
  if (!chatId) return;

  if (botWasAddedToChat(message)) {
    await sendTelegramMessage(chatId, buildConnectPrompt());
    return;
  }

  const text = String(message?.text || "").trim();
  if (!text) return;

  const connectCode = parseConnectCode(text);
  if (connectCode) {
    const result = await connectTelegramChatWithCode({
      code: connectCode,
      chatId,
      chatTitle: chatTitleFromMessage(message),
    });
    await sendTelegramMessage(chatId, result.message);
    return;
  }

  if (/^\/?start\b/i.test(text)) {
    await sendTelegramMessage(chatId, buildConnectPrompt());
    return;
  }

  if (/^\/?(?:connect|חבר)\b/i.test(text)) {
    await sendTelegramMessage(
      chatId,
      "כדי לחבר את הקבוצה צריך לשלוח רק את קוד החיבור החד-פעמי שקיבלת בבוט הניהול, למשל: TG-ABCD-1234."
    );
  }
}

async function handleCallbackQuery(callbackQuery) {
  const data = String(callbackQuery?.data || "");
  const doneMatch = data.match(/^handoff_done:(\S+)$/);
  if (!doneMatch) {
    await answerCallbackQuery(callbackQuery?.id, "פעולה לא מוכרת.");
    return;
  }

  const result = await completeHandoffNotification(doneMatch[1], {
    completedBy: callbackQuery?.from?.username || callbackQuery?.from?.id || "",
    chatId: callbackQuery?.message?.chat?.id || "",
  });
  if (!result.ok) {
    await answerCallbackQuery(callbackQuery?.id, result.message || "לא הצלחתי לעדכן.");
    return;
  }

  const sessionId = result.notification?.session_id;
  if (sessionId) {
    await switchToBot(sessionId, { reason: "telegram_handoff_done" });
  }

  await answerCallbackQuery(callbackQuery?.id, "הבוט הוחזר לשיחה.");
  await editMessageReplyMarkup({
    chatId: callbackQuery?.message?.chat?.id,
    messageId: callbackQuery?.message?.message_id,
    replyMarkup: { inline_keyboard: [] },
  });
}

router.post("/", verifyTelegramSecret, (req, res) => {
  res.status(200).send("OK");
  const update = req.body || {};
  const work = update.callback_query
    ? handleCallbackQuery(update.callback_query)
    : handleMessage(update.message || update.edited_message);
  Promise.resolve(work).catch((error) => {
    logger.error("Telegram webhook processing failed", { error: error.message });
  });
});

module.exports = router;
