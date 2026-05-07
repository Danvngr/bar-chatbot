const crypto = require("crypto");
const axios = require("axios");
const { db, admin } = require("../config/firebase");
const env = require("../config/env");
const { withRetry } = require("../utils/retry");
const logger = require("../utils/logger");

const TELEGRAM_CONNECT_CODES_COLLECTION = "telegram_connect_codes";
const TELEGRAM_CONNECT_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONNECT_CODE_PENDING = "PENDING";
const CONNECT_CODE_USED = "USED";

function getTelegramToken() {
  return String(env.TELEGRAM_BOT_TOKEN || "").trim();
}

function telegramApiUrl(method) {
  return `https://api.telegram.org/bot${getTelegramToken()}/${method}`;
}

function normalizeChatId(value) {
  return String(value || "").trim();
}

function normalizeTelegramConnectCode(code) {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
}

function generateTelegramConnectCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chars = [];
  while (chars.length < 8) {
    const byte = crypto.randomBytes(1)[0];
    chars.push(alphabet[byte % alphabet.length]);
  }
  return `TG-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

async function createTelegramConnectCode({ restaurantId, createdBy = "" }) {
  const normalizedRestaurantId = String(restaurantId || "").trim();
  if (!normalizedRestaurantId) {
    throw new Error("Missing restaurantId for Telegram connect code");
  }
  let code = "";
  let ref = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateTelegramConnectCode();
    ref = db.collection(TELEGRAM_CONNECT_CODES_COLLECTION).doc(normalizeTelegramConnectCode(code));
    const snap = await ref.get();
    if (!snap.exists) break;
    ref = null;
  }
  if (!ref) {
    throw new Error("Could not allocate Telegram connect code");
  }
  const expiresAt = new Date(Date.now() + TELEGRAM_CONNECT_CODE_TTL_MS);
  await ref.set({
    code,
    restaurant_id: normalizedRestaurantId,
    status: CONNECT_CODE_PENDING,
    created_by: String(createdBy || "").trim(),
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
  });
  await db.collection("restaurants").doc(normalizedRestaurantId).set({
    latest_telegram_connect_code: code,
    latest_telegram_connect_code_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return code;
}

function getTelegramRecipients(restaurant = {}) {
  const recipients = Array.isArray(restaurant.telegram_recipients)
    ? restaurant.telegram_recipients
    : [];
  const normalized = recipients
    .map((recipient) => {
      if (typeof recipient === "string" || typeof recipient === "number") {
        return { chat_id: normalizeChatId(recipient), enabled: true };
      }
      return {
        chat_id: normalizeChatId(recipient?.chat_id),
        title: String(recipient?.title || recipient?.name || "").trim(),
        enabled: recipient?.enabled !== false,
      };
    })
    .filter((recipient) => recipient.chat_id && recipient.enabled);

  const legacyChatId = normalizeChatId(restaurant.telegram_chat_id);
  if (legacyChatId && !normalized.some((recipient) => recipient.chat_id === legacyChatId)) {
    normalized.push({ chat_id: legacyChatId, enabled: true });
  }
  return normalized;
}

async function sendTelegramMessage(chatId, text, options = {}) {
  const token = getTelegramToken();
  const normalizedChatId = normalizeChatId(chatId);
  if (!token || !normalizedChatId) {
    return null;
  }
  return withRetry(() =>
    axios.post(telegramApiUrl("sendMessage"), {
      chat_id: normalizedChatId,
      text,
      parse_mode: options.parseMode || undefined,
      reply_markup: options.replyMarkup || undefined,
      disable_web_page_preview: true,
    })
  );
}

async function answerCallbackQuery(callbackQueryId, text = "") {
  const token = getTelegramToken();
  if (!token || !callbackQueryId) return null;
  return withRetry(() =>
    axios.post(telegramApiUrl("answerCallbackQuery"), {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    })
  );
}

async function editMessageReplyMarkup({ chatId, messageId, replyMarkup = null }) {
  const token = getTelegramToken();
  if (!token || !chatId || !messageId) return null;
  return withRetry(() =>
    axios.post(telegramApiUrl("editMessageReplyMarkup"), {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    })
  );
}

function formatTransferReason(reason) {
  const reasons = {
    explicit_human_request: "הלקוח ביקש נציג אנושי",
    explicit_manager_request: "הלקוח ביקש מנהל",
    complaint: "זוהתה תלונה או אי שביעות רצון",
    hiring_missing_info: "פנייה בנושא עבודה ללא מידע מספיק במאגר",
    unresolved: "הבוט לא מצא תשובה מדויקת",
    missing_critical_fact: "חסר מידע קריטי במאגר",
  };
  return reasons[String(reason || "").trim()] || "הפנייה הועברה לנציג";
}

async function createHandoffNotification({ restaurantId, sessionId, customerPhone, userMessage, reason }) {
  const ref = await db.collection("handoff_notifications").add({
    restaurant_id: restaurantId,
    session_id: sessionId,
    customer_phone: customerPhone,
    user_message: userMessage,
    reason: reason || "unresolved",
    status: "OPEN",
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function notifyTelegramHandoff({ restaurant, restaurantId, sessionId, customerPhone, userMessage, reason }) {
  const recipients = getTelegramRecipients(restaurant);
  if (recipients.length === 0) {
    logger.warn("No Telegram recipients configured for handoff", { restaurantId });
    return { sent: 0, notificationId: null };
  }

  const notificationId = await createHandoffNotification({
    restaurantId,
    sessionId,
    customerPhone,
    userMessage,
    reason,
  });
  const body = [
    "פנייה חדשה לנציג",
    `עסק: ${restaurant?.name || restaurantId}`,
    `לקוח: ${customerPhone}`,
    `סיבה: ${formatTransferReason(reason)}`,
    "",
    `שאלה: ${userMessage}`,
    "",
    "בסיום הטיפול לחץ על הכפתור כדי להחזיר את הבוט לשיחה.",
  ].join("\n");
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "טופל, החזר בוט", callback_data: `handoff_done:${notificationId}` }],
    ],
  };

  let sent = 0;
  for (const recipient of recipients) {
    try {
      const response = await sendTelegramMessage(recipient.chat_id, body, { replyMarkup });
      const messageId = response?.data?.result?.message_id || null;
      await db.collection("handoff_notifications").doc(notificationId).collection("deliveries").add({
        chat_id: recipient.chat_id,
        message_id: messageId,
        status: "SENT",
        sent_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      sent += 1;
    } catch (error) {
      logger.error("Telegram handoff notification failed", {
        restaurantId,
        chatId: recipient.chat_id,
        error: error.message,
      });
    }
  }
  return { sent, notificationId };
}

async function connectTelegramChatWithCode({ code, chatId, chatTitle }) {
  const normalizedCode = normalizeTelegramConnectCode(code);
  if (!normalizedCode) {
    return { ok: false, message: "לא קיבלתי קוד חיבור. שלח את הקוד שקיבלת בבוט הניהול." };
  }
  const codeRef = db.collection(TELEGRAM_CONNECT_CODES_COLLECTION).doc(normalizedCode);
  const codeSnap = await codeRef.get();
  if (!codeSnap.exists) {
    return { ok: false, message: "קוד החיבור לא תקין. בדוק את הקוד בבוט הניהול ונסה שוב." };
  }
  const codeData = codeSnap.data();
  if (codeData.status !== CONNECT_CODE_PENDING) {
    return { ok: false, message: "קוד החיבור כבר נוצל. בקש קוד חדש בבוט הניהול." };
  }
  const expiresAt = codeData.expires_at;
  if (expiresAt?.toDate && expiresAt.toDate().getTime() < Date.now()) {
    await codeRef.set({
      status: "EXPIRED",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: false, message: "קוד החיבור פג תוקף. בקש קוד חדש בבוט הניהול." };
  }

  const restaurantId = String(codeData.restaurant_id || "").trim();
  const ref = db.collection("restaurants").doc(restaurantId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, message: "לא מצאתי את העסק של הקוד הזה. בקש קוד חדש בבוט הניהול." };
  }
  const restaurant = snap.data();
  const normalizedChatId = normalizeChatId(chatId);
  const current = Array.isArray(restaurant.telegram_recipients)
    ? restaurant.telegram_recipients
    : [];
  const withoutExisting = current.filter((recipient) => normalizeChatId(recipient?.chat_id || recipient) !== normalizedChatId);
  const next = [
    ...withoutExisting,
    {
      chat_id: normalizedChatId,
      title: String(chatTitle || "").trim(),
      enabled: true,
      connected_at: new Date().toISOString(),
    },
  ];
  await ref.set({
    telegram_recipients: next,
    telegram_connected_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  await codeRef.set({
    status: CONNECT_CODE_USED,
    used_chat_id: normalizedChatId,
    used_chat_title: String(chatTitle || "").trim(),
    used_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return {
    ok: true,
    restaurantId,
    message: `הקבוצה חוברה בהצלחה להתראות הנציג של ${restaurant.name || "העסק"}.`,
  };
}

async function removeTelegramRecipient({ restaurantId, chatId }) {
  const ref = db.collection("restaurants").doc(String(restaurantId || "").trim());
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, message: "לא מצאתי את העסק." };
  }
  const restaurant = snap.data();
  const target = normalizeChatId(chatId);
  const current = Array.isArray(restaurant.telegram_recipients)
    ? restaurant.telegram_recipients
    : [];
  const next = current.filter((recipient) => normalizeChatId(recipient?.chat_id || recipient) !== target);
  if (next.length === current.length) {
    return { ok: false, message: "לא מצאתי מקבל התראות כזה." };
  }
  await ref.set({
    telegram_recipients: next,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true, message: "מקבל ההתראות הוסר מטלגרם." };
}

async function completeHandoffNotification(notificationId, metadata = {}) {
  const ref = db.collection("handoff_notifications").doc(String(notificationId || "").trim());
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, message: "לא מצאתי את הפנייה." };
  }
  const data = snap.data();
  await ref.set({
    status: "DONE",
    completed_by: metadata.completedBy || "",
    completed_chat_id: metadata.chatId || "",
    completed_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true, notification: { id: snap.id, ...data } };
}

module.exports = {
  getTelegramRecipients,
  sendTelegramMessage,
  answerCallbackQuery,
  editMessageReplyMarkup,
  notifyTelegramHandoff,
  removeTelegramRecipient,
  completeHandoffNotification,
  createTelegramConnectCode,
  connectTelegramChatWithCode,
  normalizeTelegramConnectCode,
};
