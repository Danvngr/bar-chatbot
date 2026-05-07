const express = require("express");
const env = require("../config/env");
const { db, admin } = require("../config/firebase");
const { verifyWebhookSignature } = require("../middleware/webhookVerify");
const { retrieveKnowledgeContext } = require("../services/rag");
const { chatCompletion, composeResponse, analyzeUserMessage } = require("../services/openai");
const {
  BOT_ACTIVE,
  HUMAN_ACTIVE,
  getOrCreateSession,
  claimInboundMessage,
  addMessage,
  switchToHuman,
  switchToBot,
} = require("../services/session");
const { buildPrompt } = require("../utils/promptBuilder");
const { sendTextMessage, notifyAdminTransfer } = require("../services/whatsapp");
const { logUnansweredQuestion } = require("../services/learning");
const logger = require("../utils/logger");
const {
  isAddressQuestion,
  isHumanRequestQuestion,
  isManagerRequestQuestion,
  isComplaintQuestion,
  isHiringQuestion,
  isKosherQuestion,
  isAllergyQuestion,
  isMedicalDietQuestion,
  isHighRiskRequestQuestion,
  isNudgeOnly,
  pickBestAddressFact,
  pickBestKosherFact,
  pickBestHiringFact,
  pickBestHealthSafetyFact,
  resolveBusinessTypeLabel,
  filterKnowledgeItemsForQuery,
  buildContextFromItems,
  buildRetrievalQuery,
  normalizeAssistantVoice,
  normalizeLooseText,
} = require("./webhookHelpers");

const router = express.Router();

const recentlyProcessed = new Map();
const DEDUPE_TTL_MS = 10 * 60_000;

function dedupeCleanup() {
  const now = Date.now();
  for (const [key, ts] of recentlyProcessed) {
    if (now - ts > DEDUPE_TTL_MS) {
      recentlyProcessed.delete(key);
    }
  }
}
const dedupeInterval = setInterval(dedupeCleanup, 60_000);
if (typeof dedupeInterval.unref === "function") {
  dedupeInterval.unref();
}

function detectLanguage(text) {
  const raw = String(text || "");
  if (/[\u0590-\u05FF]/.test(raw)) return "he";
  if (/[a-zA-Z]/.test(raw)) return "en";
  return "he";
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
}

function businessTypeToneHint(businessType = "") {
  const normalized = String(businessType || "").trim().toLowerCase();
  if (/(בר|bar|פאב|pub)/.test(normalized)) {
    return "זה בר: לבחור ניסוח חברי וזורם, בלי להמציא פרטים שלא קיימים בנתונים.";
  }
  if (/(קפה|בית קפה|cafe|coffee)/.test(normalized)) {
    return "זה בית קפה: לבחור ניסוח נעים ויומיומי, בלי להמציא פרטים שלא קיימים בנתונים.";
  }
  return "זו מסעדה: לבחור ניסוח שירותי ברור וחם, בלי להמציא פרטים שלא קיימים בנתונים.";
}

function shouldUseHeavyModel({ intent = "", userMessage = "", hardFacts = {} }) {
  const intentText = String(intent || "").toLowerCase();
  if (intentText.includes("complaint")) return true;

  const msg = String(userMessage || "");
  if (
    isComplaintQuestion(msg)
    || isAllergyQuestion(msg)
    || isMedicalDietQuestion(msg)
    || isHighRiskRequestQuestion(msg)
  ) {
    return true;
  }

  const factsText = JSON.stringify(hardFacts || {});
  return /(אלרג|רגיש|גלוטן|צליאק|רפוא|סוכרת|הריון|אנפיל|allerg|gluten|celiac|medical|diabet|pregnan|anaphyl)/i.test(factsText);
}

function maybeClampOverpromises(text, userMessage = "") {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  const normalized = String(raw).toLowerCase();
  const user = String(userMessage || "");
  const riskyTopic = isAllergyQuestion(user) || isMedicalDietQuestion(user) || isHighRiskRequestQuestion(user);
  const hasGuarantee = /(מתחייב|מובטח|בוודאות|לגמרי בטוח|100%|100 אחוז|אין סיכון בכלל|אין זיהום משני בכלל|guarantee|guaranteed|completely safe|no risk)/i.test(normalized);
  if (!riskyTopic || !hasGuarantee) return raw;
  return "אני לא רוצה להטעות בנושא רגיש. כדי לתת תשובה מדויקת ובטוחה, אני מעביר אותך לנציג שיבדוק מול הצוות המקצועי.";
}

function shouldUseSemanticPlaceIdentityReply(semanticUnderstanding = {}) {
  return semanticUnderstanding?.intent === "place_identity"
    && Number(semanticUnderstanding?.confidence || 0) >= 0.84
    && semanticUnderstanding?.should_bypass_address_flow === true;
}

async function sendCustomerMessage(parsed, message) {
  const normalizedMessage = normalizeAssistantVoice(message);
  await sendTextMessage(parsed.customerPhone, normalizedMessage, { phoneNumberId: parsed.phoneNumberId });
  return normalizedMessage;
}

async function composeCustomerReply({
  language = "he",
  intent,
  restaurantName,
  businessType = "",
  userMessage = "",
  ragContext = "",
  hardFacts = {},
  emergencyText,
}) {
  const useHeavyModel = shouldUseHeavyModel({ intent, userMessage, hardFacts });
  const selectedModel = useHeavyModel
    ? (env.ADMIN_OPENAI_CHAT_MODEL || env.OPENAI_CHAT_MODEL)
    : env.OPENAI_CHAT_MODEL;

  return composeResponse({
    intent,
    context: {
      restaurant_name: restaurantName || "",
      business_type: String(businessType || ""),
      user_message: String(userMessage || ""),
      rag_context: String(ragContext || ""),
    },
    hardFacts,
    tonePolicy: [
      "ניסוח קצר, חם, טבעי וישיר.",
      "לא ניסוח רובוטי.",
      "הדובר הוא אדם יחיד מהצוות. מותר גם 'אנחנו' ו'יש לנו' כשמדברים על העסק, כולל שילוב עם 'אני' באותה תשובה בצורה דקדוקית תקינה.",
      businessTypeToneHint(businessType),
      "אם שאלה דומה חוזרת, גוון פתיחה וניסוח כדי לא להישמע כמו הודעה משוכפלת.",
      "לא לחשוף בוט/AI/מערכת.",
      "אם אין מידע מספיק - לומר בקצרה ולהכווין לצעד הבא.",
    ],
    language,
    options: {
      apiKey: env.OPENAI_API_KEY,
      model: selectedModel,
      temperature: 0.6,
      emergencyText:
        emergencyText
        || (language === "en"
          ? "Please try again in a moment."
          : "אפשר לנסות שוב בעוד רגע."),
    },
  });
}

function nowContextForPrompt() {
  const now = new Date();
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const israelFormatter = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = israelFormatter.formatToParts(now);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || "";

  const israelDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const dayName = days[israelDate.getDay()];

  return `היום: יום ${dayName}, ${get("day")}/${get("month")}/${get("year")}, שעה ${get("hour")}:${get("minute")} (שעון ישראל)`;
}

function extractMessage(payload) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message) {
    return null;
  }
  const base = {
    messageId: message.id || null,
    customerPhone: message.from,
    phoneNumberId: value?.metadata?.phone_number_id,
  };
  if (message.type === "text") {
    return { ...base, text: message.text?.body?.trim() || "", nonText: false };
  }
  if (["image", "audio", "video", "sticker", "document", "location", "contacts"].includes(message.type)) {
    return { ...base, text: "", nonText: true, mediaType: message.type };
  }
  return null;
}

async function getRestaurantByPhoneNumberId(phoneNumberId) {
  const snap = await db.collection("restaurants").where("whatsapp_phone_number_id", "==", phoneNumberId).limit(2).get();
  if (snap.empty) {
    return null;
  }
  if (snap.size > 1) {
    logger.error("Duplicate restaurant mapping for phone_number_id", { phoneNumberId, count: snap.size });
    return null;
  }
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function markRestaurantNeedsAttention(restaurantId) {
  await db.collection("restaurants").doc(restaurantId).set(
    {
      status: "NEEDS_ATTENTION",
      last_error_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function escalateToHuman({
  sessionId,
  parsed,
  restaurant,
  restaurantId,
  language,
  userMessage,
  customerMessage,
  reason = "unresolved",
}) {
  const normalizedCustomerMessage = normalizeAssistantVoice(customerMessage);
  await switchToHuman(sessionId, { reason });
  await logUnansweredQuestion({
    restaurantId,
    phoneNumber: parsed.customerPhone,
    userMessage,
  });
  await markRestaurantNeedsAttention(restaurantId);
  await addMessage(sessionId, "assistant", normalizedCustomerMessage);
  await sendCustomerMessage(parsed, normalizedCustomerMessage);
  await notifyAdminTransfer(restaurantId, parsed.customerPhone, userMessage, language, { reason, sessionId });
  logger.info("Transferred customer to human", { restaurantId, reason });
}

function isBotResumeRequest(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  return /(תחזיר(ו)? את הבוט|הבוט יכול לענות|שהבוט יענה|תן לבוט לענות|אפשר להמשיך עם הבוט|אני רוצה את הבוט|המשך עם הבוט|bot can answer|continue with bot)/i.test(value);
}

function isAffirmativeHandoffConsent(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  return /^(כן|כן תודה|כן בבקשה|תעביר|תעבירו|אפשר|בטח|סבבה|יאללה|yes|please|ok|okay)$/i.test(normalized);
}

function lastAssistantAskedToTransfer(history = []) {
  const messages = Array.isArray(history) ? history : [];
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const content = normalizeLooseText(lastAssistant?.content || "");
  return /(תרצה|תרצי|רוצה|רוצה שאעביר|להעביר).*(נציג|לנציג)|נציג.*(מהצוות|אצלנו)/.test(content);
}

function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : "";
}

function isMenuDetailQuestion(text, semanticUnderstanding = {}) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  if (semanticUnderstanding?.intent === "menu") return true;
  const menuTerms = /(תפריט|מנה|מנות|אוכל|שתיה|שתייה|כוס|יין|בירה|קוקטייל|פסטה|פיצה|שניצל|המבורגר|סלט|קינוח|dessert|dish|menu|beer|wine|cocktail|pasta|pizza)/i.test(normalized);
  return menuTerms;
}

function findMenuLink(items = []) {
  if (!Array.isArray(items)) return "";
  for (const item of items) {
    const category = normalizeLooseText(item?.category || "");
    const content = String(item?.content || "");
    const normalizedContent = normalizeLooseText(content);
    if (category === "menu" || /תפריט|menu/.test(normalizedContent)) {
      const url = extractFirstUrl(content);
      if (url) return url;
    }
  }
  return "";
}

async function recordMissingInfoQuestion({ restaurantId, parsed, userMessage }) {
  await logUnansweredQuestion({
    restaurantId,
    phoneNumber: parsed.customerPhone,
    userMessage,
  });
  await markRestaurantNeedsAttention(restaurantId);
}

const NEW_CUSTOMER_INQUIRY_WINDOW_MS = 12 * 60 * 60 * 1000;

function isNewCustomerInquiry(history = []) {
  const messages = Array.isArray(history) ? history : [];
  if (messages.length === 0) return true;
  const lastTs = Math.max(...messages.map((m) => Number(m?.ts || 0)).filter((ts) => Number.isFinite(ts)));
  if (!lastTs) return false;
  return Date.now() - lastTs > NEW_CUSTOMER_INQUIRY_WINDOW_MS;
}

function isBareHandoffRequest(text) {
  const normalized = String(text || "")
    .replace(/[?!.,:;״"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  return isHumanRequestQuestion(normalized) || isManagerRequestQuestion(normalized);
}

function asksForMehadrin(text) {
  return /(מהדרין|בדצ|בדץ|בד״צ)/.test(String(text || ""));
}

function kosherLevelFromFact(fact) {
  const normalized = String(fact || "").toLowerCase();
  if (!normalized) return "unknown";
  if (/(אין כשרות|לא כשר|ללא כשרות)/.test(normalized)) return "none";
  if (/(מהדרין|בדצ|בדץ|בד״צ)/.test(normalized)) return "mehadrin";
  if (/(כשר|רבנות)/.test(normalized)) return "kosher";
  return "unknown";
}

async function processIncomingMessage(payload) {
  const parsed = extractMessage(payload);
  if (!parsed) {
    return;
  }

  if (parsed.messageId && recentlyProcessed.has(parsed.messageId)) {
    logger.info("Duplicate message seen in memory", { messageId: parsed.messageId });
  }

  if (parsed.nonText) {
    const nonTextReply = await composeCustomerReply({
      language: "he",
      intent: "customer_non_text",
      hardFacts: {
        instruction: "כרגע ניתן לטפל רק בהודעות טקסט.",
      },
      emergencyText: "כרגע אפשר לטפל רק בהודעות טקסט. כתוב לי הודעה ואמשיך איתך.",
    });
    await sendCustomerMessage(parsed, nonTextReply);
    return;
  }

  if (!parsed.text) {
    return;
  }

  const language = detectLanguage(parsed.text);

  const restaurant = await getRestaurantByPhoneNumberId(parsed.phoneNumberId);
  if (!restaurant) {
    logger.warn("No restaurant matched phone_number_id", { phoneNumberId: parsed.phoneNumberId });
    return;
  }

  const restaurantId = restaurant.restaurant_id || restaurant.id;
  const topLevelBusinessType = resolveBusinessTypeLabel(restaurant);
  const session = await getOrCreateSession(parsed.customerPhone, restaurantId);
  if (parsed.messageId) {
    const claimed = await claimInboundMessage(session.id, parsed.messageId);
    if (!claimed) {
      logger.info("Duplicate message skipped by session guard", { messageId: parsed.messageId, sessionId: session.id });
      return;
    }
    recentlyProcessed.set(parsed.messageId, Date.now());
  }
  await addMessage(session.id, "user", parsed.text);

  if (session.status === HUMAN_ACTIVE) {
    if (isBotResumeRequest(parsed.text)) {
      await switchToBot(session.id, { reason: "customer_requested_bot_resume" });
      const resumedReply = await composeCustomerReply({
        language,
        intent: "customer_requested_bot_resume",
        restaurantName: restaurant.name,
        businessType: topLevelBusinessType,
        userMessage: parsed.text,
        hardFacts: {
          instruction: "הלקוח ביקש שהבוט יחזור לענות. אשר בקצרה שאפשר להמשיך ושאל איך אפשר לעזור.",
        },
        emergencyText:
          language === "en"
            ? "Sure, I can continue helping here. What would you like to know?"
            : "בטח, אני יכול להמשיך לעזור כאן. מה תרצה לדעת?",
      });
      await addMessage(session.id, "assistant", resumedReply);
      await sendCustomerMessage(parsed, resumedReply);
      return;
    }
    const waitMessage = await composeCustomerReply({
      language,
      intent: "customer_human_active_wait",
      restaurantName: restaurant.name,
      businessType: topLevelBusinessType,
      userMessage: parsed.text,
      hardFacts: {
        instruction: "הפנייה כבר הועברה לנציג ותטופל בהקדם.",
      },
      emergencyText:
        language === "en"
          ? "Your request is being handled. We will get back to you shortly."
          : "הפנייה שלך בטיפול, ונציג יחזור אליך בהקדם.",
    });
    await sendCustomerMessage(parsed, waitMessage);
    return;
  }
  if (session.status !== BOT_ACTIVE) {
    return;
  }

  const history = (session.messages || []).map((m) => ({ role: m.role, content: m.content })).slice(-15);
  const previousUserMessage = [...history].reverse().find((m) => m.role === "user")?.content || "";
  if (isAffirmativeHandoffConsent(parsed.text) && lastAssistantAskedToTransfer(history)) {
    const handoffReply = await composeCustomerReply({
      language,
      intent: "customer_accepted_handoff_offer",
      restaurantName: restaurant.name,
      businessType: topLevelBusinessType,
      userMessage: parsed.text,
      hardFacts: {
        instruction: "הלקוח אישר להעביר לנציג אחרי שהבוט שאל אם להעביר. אשר בקצרה והעבר לנציג מהצוות.",
      },
      emergencyText:
        language === "en"
          ? "Sure, I am transferring this to a representative from our team."
          : "בטח, אני מעביר את זה לנציג מהצוות שלנו.",
    });
    await escalateToHuman({
      sessionId: session.id,
      parsed,
      restaurant,
      restaurantId,
      language,
      userMessage: previousUserMessage || parsed.text,
      customerMessage: handoffReply,
      reason: "explicit_human_request",
    });
    return;
  }

  if (isNudgeOnly(parsed.text)) {
    const nudgeReply = await composeCustomerReply({
      language,
      intent: "customer_nudge_followup",
      restaurantName: restaurant.name,
      businessType: topLevelBusinessType,
      userMessage: parsed.text,
      hardFacts: {
        instruction:
          language === "en"
            ? "Acknowledge warmly and ask one clear follow-up question tied to the previous context."
            : "הגב בחום ובטבעיות, והצע שאלה אחת ממוקדת להמשך לפי ההקשר הקודם.",
        previous_context: previousUserMessage || "",
      },
      emergencyText:
        language === "en"
          ? "I saw your message. If you want, I can transfer you to a representative now."
          : "ראיתי את ההודעה שלך. אם נוח לך, אני מעביר אותך לנציג אצלנו כבר עכשיו.",
    });
    await addMessage(session.id, "assistant", nudgeReply);
    await sendCustomerMessage(parsed, nudgeReply);
    return;
  }

  const isComplaint = isComplaintQuestion(parsed.text);
  const isExplicitHandoff = isManagerRequestQuestion(parsed.text) || isHumanRequestQuestion(parsed.text);
  if (isExplicitHandoff || isComplaint) {
    if (!isComplaint && isNewCustomerInquiry(history) && isBareHandoffRequest(parsed.text)) {
      const clarificationReply = await composeCustomerReply({
        language,
        intent: "customer_initial_handoff_clarification",
        restaurantName: restaurant.name,
        businessType: topLevelBusinessType,
        userMessage: parsed.text,
        hardFacts: {
          instruction:
            language === "en"
              ? "Do not transfer yet. Ask the customer to briefly explain what they need first. Mention that if they still want a representative after that, you will transfer them."
              : "אל תעביר עדיין לנציג. בקש מהלקוח לכתוב בקצרה במה מדובר, וציין שאם אחרי זה עדיין ירצה נציג תעביר את הפנייה.",
        },
        emergencyText:
          language === "en"
            ? "Sure. Before I transfer you, please write briefly what this is about. If you still want a representative after that, I will transfer your request."
            : "בשמחה. לפני שאני מעביר לנציג, תוכל לכתוב בקצרה במה מדובר? אם אחרי זה עדיין תרצה נציג, אעביר את הפנייה.",
      });
      await addMessage(session.id, "assistant", normalizeAssistantVoice(clarificationReply));
      await sendCustomerMessage(parsed, clarificationReply);
      return;
    }

    const reason = isComplaint
      ? "complaint"
      : (isManagerRequestQuestion(parsed.text) ? "explicit_manager_request" : "explicit_human_request");
    const handoffReply = await composeCustomerReply({
      language,
      intent: "customer_explicit_handoff_request",
      restaurantName: restaurant.name,
      businessType: topLevelBusinessType,
      userMessage: parsed.text,
      hardFacts: {
        instruction:
          language === "en"
            ? "Confirm politely and transfer to a human representative from the business."
            : "אשר בנימוס והעבר לנציג אנושי מתוך העסק.",
      },
      emergencyText:
        language === "en"
          ? "Absolutely. I am transferring you to a representative from our team now."
          : "בטח, אני מעביר אותך עכשיו לנציג אנושי מהצוות.",
    });
    await escalateToHuman({
      sessionId: session.id,
      parsed,
      restaurant,
      restaurantId,
      language,
      userMessage: parsed.text,
      customerMessage: handoffReply,
      reason,
    });
    return;
  }

  const semanticUnderstanding = await analyzeUserMessage({
    message: parsed.text,
    conversationHistory: history,
    restaurantName: restaurant.name,
    businessType: topLevelBusinessType,
    language,
  });

  if (shouldUseSemanticPlaceIdentityReply(semanticUnderstanding)) {
    const placeName = String(restaurant.name || "").trim();
    const identityReply = await composeCustomerReply({
      language,
      intent: "customer_place_identity_confirmation",
      restaurantName: restaurant.name,
      businessType: topLevelBusinessType,
      userMessage: parsed.text,
      hardFacts: {
        place_name: placeName,
        instruction:
          language === "en"
            ? "The customer is confirming what place they reached. Answer with the place name only, briefly, without address, parking or extra details unless asked."
            : "הלקוח רק מוודא לאיזה מקום הוא הגיע. ענה בקצרה בשם המקום בלבד, בלי כתובת, חניה או פרטים נוספים אלא אם ביקש.",
      },
      emergencyText:
        language === "en"
          ? `You reached ${placeName || "us"}.`
          : (placeName ? `הגעת ל${placeName}.` : "הגעת אלינו."),
    });
    await addMessage(session.id, "assistant", normalizeAssistantVoice(identityReply));
    await sendCustomerMessage(parsed, identityReply);
    return;
  }

  const retrievalQuery = String(semanticUnderstanding?.retrieval_query || "").trim() || buildRetrievalQuery(parsed.text, history);
  const { context: rawContext, items: rawItems } = await retrieveKnowledgeContext(restaurantId, retrievalQuery || parsed.text);
  const topicFilter = filterKnowledgeItemsForQuery(rawItems, parsed.text);
  const scopedItems = Array.isArray(topicFilter.items) ? topicFilter.items : [];
  const context = buildContextFromItems(scopedItems);
  const effectiveContext = context || rawContext || "";
  const effectiveItems = scopedItems.length > 0 ? scopedItems : (Array.isArray(rawItems) ? rawItems : []);
  const businessType = resolveBusinessTypeLabel(restaurant, effectiveItems) || topLevelBusinessType;
  const menuLink = findMenuLink(effectiveItems) || findMenuLink(rawItems);

  if (isAllergyQuestion(parsed.text) || isMedicalDietQuestion(parsed.text) || isHighRiskRequestQuestion(parsed.text)) {
    const healthFact = pickBestHealthSafetyFact(effectiveItems);
    if (!healthFact) {
      const safeHealthFallback = await composeCustomerReply({
        language,
        intent: "customer_health_safety_missing_fact",
        restaurantName: restaurant.name,
        businessType,
        userMessage: parsed.text,
        ragContext: effectiveContext,
        hardFacts: {
          instruction: "אין כרגע במערכת תשובה חד-משמעית ובטוחה בנושא אלרגיות/תזונה רפואית.",
          next_step: "אל תנחש. העבר לנציג אנושי לבדיקה מול הצוות המקצועי.",
        },
        emergencyText: "אני לא רוצה להטעות בנושא רגיש. כדי לתת תשובה מדויקת ובטוחה, אני מעביר אותך לנציג שיבדוק מול הצוות המקצועי.",
      });
      await escalateToHuman({
        sessionId: session.id,
        parsed,
        restaurant,
        restaurantId,
        language,
        userMessage: parsed.text,
        customerMessage: safeHealthFallback,
        reason: "missing_critical_fact",
      });
      return;
    }

    const safeHealthReply = await composeCustomerReply({
      language,
      intent: "customer_health_safety_fact",
      restaurantName: restaurant.name,
      businessType,
      userMessage: parsed.text,
      hardFacts: {
        health_fact: healthFact,
        instruction: "ענה בזהירות ובדיוק לפי העובדה בלבד. אל תבטיח אפס סיכון ואל תנסח קביעה רפואית מוחלטת.",
      },
      emergencyText: `לפי המידע המעודכן אצלי: ${healthFact}`,
    });
    const clampedHealthReply = maybeClampOverpromises(safeHealthReply, parsed.text);
    await addMessage(session.id, "assistant", normalizeAssistantVoice(clampedHealthReply));
    await sendCustomerMessage(parsed, clampedHealthReply);
    return;
  }

  if (isMenuDetailQuestion(parsed.text, semanticUnderstanding)) {
    let resolvedMenuLink = menuLink;
    if (!resolvedMenuLink) {
      const menuLookup = await retrieveKnowledgeContext(
        restaurantId,
        "תפריט אוכל עיקרי קישור תפריט menu link",
        { topK: 8, minScore: 0.05 }
      );
      resolvedMenuLink = findMenuLink(menuLookup?.items);
    }

    if (resolvedMenuLink) {
      const menuFallback = await composeCustomerReply({
        language,
        intent: "customer_menu_link_fallback",
        restaurantName: restaurant.name,
        businessType,
        userMessage: parsed.text,
        hardFacts: {
          menu_link: resolvedMenuLink,
          instruction:
            "אין מחיר או פירוט מדויק על הפריט הספציפי במידע שנשלף. אל תנחש. הפנה לתפריט שלנו בקישור, בניסוח פנימי של העסק.",
        },
        emergencyText:
          language === "en"
            ? `I do not have the exact price for that item here, but you can check our menu here: ${resolvedMenuLink}`
            : `אין לי כאן מחיר מדויק לפריט הזה, אבל אפשר לבדוק בתפריט שלנו כאן: ${resolvedMenuLink}`,
      });
      await addMessage(session.id, "assistant", normalizeAssistantVoice(menuFallback));
      await sendCustomerMessage(parsed, menuFallback);
      return;
    }

    await recordMissingInfoQuestion({ restaurantId, parsed, userMessage: parsed.text });
    const askTransfer = await composeCustomerReply({
      language,
      intent: "customer_missing_menu_detail_offer_handoff",
      restaurantName: restaurant.name,
      businessType,
      userMessage: parsed.text,
      hardFacts: {
        instruction:
          "אין מידע מדויק על פריט/מחיר בתפריט ואין קישור תפריט זמין. אל תעביר אוטומטית. אמור שאין כרגע מידע מדויק ושאל אם להעביר לנציג מהצוות.",
      },
      emergencyText:
        language === "en"
          ? "I do not have exact information about that menu item right now. Would you like me to transfer this to a representative from our team?"
          : "אין לי כרגע מידע מדויק על הפריט הזה בתפריט שלנו. תרצה שאעביר את השאלה לנציג מהצוות?",
    });
    await addMessage(session.id, "assistant", normalizeAssistantVoice(askTransfer));
    await sendCustomerMessage(parsed, askTransfer);
    return;
  }

  if (isAddressQuestion(parsed.text)) {
    const addressFact = pickBestAddressFact(effectiveItems);
    if (!addressFact) {
      const safeNoAddress = await composeCustomerReply({
        language,
        intent: "customer_missing_address_fact",
        restaurantName: restaurant.name,
        businessType,
        userMessage: parsed.text,
        ragContext: context,
        hardFacts: {
          instruction: "אין כרגע כתובת מדויקת זמינה במערכת.",
          next_step:
            language === "en"
              ? "Connect the customer with a representative for an exact location."
              : "חבר את הלקוח לנציג לקבלת מיקום מדויק.",
        },
        emergencyText:
          language === "en"
            ? "I want to make sure you get the exact location. I am connecting you with a representative now."
            : "חשוב לי לתת לך כתובת מדויקת, אז אני מחבר אותך לנציג שייתן מיקום מדויק עכשיו.",
      });
      await escalateToHuman({
        sessionId: session.id,
        parsed,
        restaurant,
        restaurantId,
        language,
        userMessage: parsed.text,
        customerMessage: safeNoAddress,
        reason: "missing_critical_fact",
      });
      return;
    }

    const addressReply = await composeCustomerReply({
      language,
      intent: "customer_address_fact",
      restaurantName: restaurant.name,
      businessType,
      userMessage: parsed.text,
      hardFacts: {
        address: addressFact,
        instruction:
          language === "en"
            ? "Use only this exact address fact. Do not invent or add new location details."
            : "השתמש רק בכתובת הזו כפי שהיא. אל תמציא ואל תוסיף פרטי מיקום שלא מופיעים בעובדה.",
      },
      emergencyText:
        language === "en"
          ? addressFact
          : `הכתובת היא: ${addressFact}`,
    });
    await addMessage(session.id, "assistant", addressReply);
    await sendCustomerMessage(parsed, addressReply);
    return;
  }

  if (isKosherQuestion(parsed.text)) {
    const kosherFact = pickBestKosherFact(effectiveItems);
    if (!kosherFact) {
      const missingKosherReply = await composeCustomerReply({
        language,
        intent: "customer_missing_kosher_fact",
        restaurantName: restaurant.name,
        businessType,
        userMessage: parsed.text,
        ragContext: effectiveContext,
        hardFacts: {
          instruction: "אין כרגע במערכת פירוט מדויק מספיק על סוג הכשרות.",
          next_step: "חבר לנציג כדי לתת תשובת כשרות מדויקת.",
        },
        emergencyText: "אני רוצה לענות לך מדויק על הכשרות, אז אני מעביר לנציג שיעדכן אותך בפרטים המדויקים.",
      });
      await escalateToHuman({
        sessionId: session.id,
        parsed,
        restaurant,
        restaurantId,
        language,
        userMessage: parsed.text,
        customerMessage: missingKosherReply,
        reason: "missing_critical_fact",
      });
      return;
    }

    const level = kosherLevelFromFact(kosherFact);
    const askedMehadrin = asksForMehadrin(parsed.text);
    if (askedMehadrin && level === "kosher") {
      const mehadrinReply = await composeCustomerReply({
        language,
        intent: "customer_kosher_mehadrin_check",
        restaurantName: restaurant.name,
        businessType,
        userMessage: parsed.text,
        hardFacts: {
          kosher_fact: kosherFact,
          instruction: "ענו בבירור: מסומן כשר רגיל, לא מסומן כשר למהדרין.",
        },
        emergencyText: "אצלי מסומן שהמקום כשר, ולא כשר למהדרין.",
      });
      await addMessage(session.id, "assistant", normalizeAssistantVoice(mehadrinReply));
      await sendCustomerMessage(parsed, mehadrinReply);
      return;
    }

    const kosherReply = await composeCustomerReply({
      language,
      intent: "customer_kosher_fact",
      restaurantName: restaurant.name,
      businessType,
      userMessage: parsed.text,
      hardFacts: {
        kosher_fact: kosherFact,
        instruction: "ענה בקצרה ובדיוק על הכשרות לפי העובדה בלבד.",
      },
      emergencyText: level === "none" ? "המקום לא כשר." : `הכשרות שמסומנת אצלי היא: ${kosherFact}.`,
    });
    await addMessage(session.id, "assistant", normalizeAssistantVoice(kosherReply));
    await sendCustomerMessage(parsed, kosherReply);
    return;
  }

  if (isHiringQuestion(parsed.text)) {
    const hiringFact = pickBestHiringFact(effectiveItems);
    if (!hiringFact) {
      const businessPhone = String(restaurant.phone_number || "").trim();
      const hiringFallback = await composeCustomerReply({
        language,
        intent: "customer_hiring_no_fact",
        restaurantName: restaurant.name,
        businessType,
        userMessage: parsed.text,
        hardFacts: {
          business_phone: businessPhone || "",
          instruction:
            language === "en"
              ? "Do not answer as an external party. Speak from inside the business and offer transfer to a representative."
              : "אל תנסח כגורם חיצוני. דבר מבפנים והצע העברה לנציג מהצוות.",
        },
        emergencyText: businessPhone
          ? `בנושא עבודה, אפשר לשלוח אליי פרטים למספר ${businessPhone}, ואם נוח לך אני גם יכול להעביר לנציג מהצוות.`
          : "בנושא עבודה, אם נוח לך אני מעביר את הפנייה לנציג מהצוות שימשיך איתך.",
      });
      await escalateToHuman({
        sessionId: session.id,
        parsed,
        restaurant,
        restaurantId,
        language,
        userMessage: parsed.text,
        customerMessage: hiringFallback,
        reason: "hiring_missing_info",
      });
      return;
    }
    const hiringReply = await composeCustomerReply({
      language,
      intent: "customer_hiring_with_fact",
      restaurantName: restaurant.name,
      businessType,
      userMessage: parsed.text,
      hardFacts: {
        hiring_info: hiringFact,
        instruction:
          language === "en"
            ? "Use only the hiring info fact as-is and keep an in-house tone."
            : "השתמש רק בעובדת הגיוס כפי שהיא, בטון פנימי של העסק.",
      },
      emergencyText: hiringFact,
    });
    await addMessage(session.id, "assistant", normalizeAssistantVoice(hiringReply));
    await sendCustomerMessage(parsed, hiringReply);
    return;
  }

  if (topicFilter.strictTopicMatch && scopedItems.length === 0) {
    const missingTopicReply = await composeCustomerReply({
      language,
      intent: "customer_missing_topic_fact",
      restaurantName: restaurant.name,
      businessType,
      userMessage: parsed.text,
      hardFacts: {
        instruction: "אין כרגע במערכת פרטים מספיקים לענות באופן מדויק על הנושא שביקשו.",
      },
      emergencyText: "אני רוצה לענות מדויק, ובנושא הזה חסר לי כרגע פרט במערכת. אם נוח לך, אני מעביר לנציג שישלים את זה מיד.",
    });
    await escalateToHuman({
      sessionId: session.id,
      parsed,
      restaurant,
      restaurantId,
      language,
      userMessage: parsed.text,
      customerMessage: missingTopicReply,
      reason: "missing_critical_fact",
    });
    return;
  }

  const messages = buildPrompt({
    systemPromptBase: restaurant.system_prompt_base,
    ragContext: effectiveContext,
    conversationHistory: [...history, { role: "user", content: parsed.text }],
    nowContext: nowContextForPrompt(),
    restaurantName: restaurant.name,
    businessType,
    semanticUnderstanding,
  });
  const freeTextModel = shouldUseHeavyModel({ intent: "chat_general", userMessage: parsed.text })
    ? (env.ADMIN_OPENAI_CHAT_MODEL || env.OPENAI_CHAT_MODEL)
    : env.OPENAI_CHAT_MODEL;
  const reply = await chatCompletion(messages, {
    apiKey: env.OPENAI_API_KEY,
    model: freeTextModel,
    temperature: 0.6,
    fallbackText: "TRANSFER_TO_HUMAN",
  });

  if ((reply || "").includes("TRANSFER_TO_HUMAN")) {
    const isAdminPhone = restaurant.admin_phone && normalizePhone(parsed.customerPhone) === normalizePhone(restaurant.admin_phone);

    if (isAdminPhone) {
      const fallback = await composeCustomerReply({
        language,
        intent: "owner_no_answer",
        restaurantName: restaurant.name,
        businessType,
        userMessage: parsed.text,
        ragContext: effectiveContext,
        hardFacts: {
          instruction: "אין כרגע תשובה מדויקת בידע הקיים.",
          next_step: "אפשר להוסיף את המידע דרך בוט הניהול.",
        },
        emergencyText:
          language === "en"
            ? "I don't have an exact answer right now. You can add this information via the admin bot."
            : "אין לי כרגע תשובה מדויקת. אפשר להוסיף את המידע דרך בוט הניהול.",
      });
      await addMessage(session.id, "assistant", normalizeAssistantVoice(fallback));
      await sendCustomerMessage(parsed, fallback);
      return;
    }

    const transferMessage = await composeCustomerReply({
      language,
      intent: "transfer_to_human",
      restaurantName: restaurant.name,
      businessType,
      userMessage: parsed.text,
      ragContext: effectiveContext,
      hardFacts: {
        instruction: "הבקשה מועברת לנציג אנושי להמשך טיפול.",
      },
      emergencyText:
        language === "en"
          ? "I am connecting you with a representative who can help. We will get back to you shortly."
          : "אני מחבר אותך עם נציג שיוכל לעזור. נציג יחזור אליך בהקדם.",
    });
    await escalateToHuman({
      sessionId: session.id,
      parsed,
      restaurant,
      restaurantId,
      language,
      userMessage: parsed.text,
      customerMessage: transferMessage,
      reason: "unresolved",
    });
    return;
  }

  const clampedReply = maybeClampOverpromises(reply, parsed.text);
  await addMessage(session.id, "assistant", normalizeAssistantVoice(clampedReply));
  await sendCustomerMessage(parsed, clampedReply);
}

router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const verifyToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && verifyToken === env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send("Verification failed");
});

router.post("/", verifyWebhookSignature, (req, res) => {
  res.status(200).send("OK");
  processIncomingMessage(req.body).catch((error) => {
    logger.error("Async webhook processing failed", { error: error.message });
  });
});

router.__test__ = {
  ...require("./webhookHelpers"),
  processIncomingMessage,
};

module.exports = router;
