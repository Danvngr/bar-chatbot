const axios = require("axios");
const env = require("../config/env");
const { withRetry } = require("../utils/retry");
const { notifyTelegramHandoff } = require("./telegram");

function buildMessagesUrl(phoneNumberId) {
  return `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
}

async function sendTextMessageWithCredentials({ to, message, accessToken, phoneNumberId }) {
  const baseUrl = buildMessagesUrl(phoneNumberId);
  return withRetry(() =>
    axios.post(
      baseUrl,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )
  );
}

async function sendTextMessage(to, message, options = {}) {
  const accessToken = String(options.accessToken || env.WHATSAPP_ACCESS_TOKEN || "").trim();
  const phoneNumberId = String(options.phoneNumberId || env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  return sendTextMessageWithCredentials({
    to,
    message,
    accessToken,
    phoneNumberId,
  });
}

async function sendAdminTextMessage(to, message) {
  const accessToken = env.ADMIN_WHATSAPP_ACCESS_TOKEN || env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.ADMIN_WHATSAPP_PHONE_NUMBER_ID || env.WHATSAPP_PHONE_NUMBER_ID;
  return sendTextMessageWithCredentials({ to, message, accessToken, phoneNumberId });
}

function formatTransferReason(reason, language = "he") {
  const key = String(reason || "").trim().toLowerCase();
  const he = {
    explicit_human_request: "הלקוח ביקש נציג אנושי",
    explicit_manager_request: "הלקוח ביקש מנהל",
    complaint: "זוהתה תלונה/אי שביעות רצון",
    hiring_missing_info: "פנייה בנושא עבודה ללא מידע מספיק במאגר",
    unresolved: "הבוט לא מצא תשובה מדויקת",
    missing_critical_fact: "חסר מידע קריטי במאגר",
  };
  const en = {
    explicit_human_request: "Customer requested a human representative",
    explicit_manager_request: "Customer requested a manager",
    complaint: "Complaint or dissatisfaction detected",
    hiring_missing_info: "Hiring inquiry without enough knowledge",
    unresolved: "Bot could not provide an exact answer",
    missing_critical_fact: "Critical fact is missing from knowledge",
  };
  const dict = String(language || "he").toLowerCase() === "en" ? en : he;
  return dict[key] || null;
}

async function notifyAdminTransfer(restaurantId, customerPhone, userMessage, language = "he", options = {}) {
  const restaurant = await getRestaurantAdmin(restaurantId);
  return notifyTelegramHandoff({
    restaurant,
    restaurantId,
    sessionId: options.sessionId || `${customerPhone}_${restaurantId}`,
    customerPhone,
    userMessage,
    reason: options.reason,
    language,
  });
}

async function getRestaurantAdmin(restaurantId) {
  const { db } = require("../config/firebase");
  const snap = await db.collection("restaurants").doc(restaurantId).get();
  return snap.exists ? snap.data() : null;
}

async function sendInteractiveButtons({ to, bodyText, buttons, accessToken, phoneNumberId }) {
  const token = accessToken || env.ADMIN_WHATSAPP_ACCESS_TOKEN || env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = phoneNumberId || env.ADMIN_WHATSAPP_PHONE_NUMBER_ID || env.WHATSAPP_PHONE_NUMBER_ID;
  const baseUrl = buildMessagesUrl(phoneId);
  return withRetry(() =>
    axios.post(
      baseUrl,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons.map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    )
  );
}

module.exports = { sendTextMessage, sendAdminTextMessage, notifyAdminTransfer, sendInteractiveButtons };
