const { db, admin } = require("../config/firebase");
const { chatCompletion, createEmbedding, composeResponse } = require("./openai");
const {
  sendAdminTextMessage: sendAdminTextMessageRaw,
  sendTextMessage,
  sendInteractiveButtons,
} = require("./whatsapp");
const { invalidateCache, retrieveKnowledgeContext } = require("./rag");
const { switchToBot } = require("./session");
const { provisionRestaurant } = require("./provisioning");
const { getPendingInviteCode, redeemInviteCode } = require("./inviteCodes");
const { normalizeOnboardingAnswer, composeOnboardingQuestion } = require("./onboardingAi");
const { validateOnboardingField } = require("./onboardingValidation");
const { validateManagerCode, hashManagerCode, verifyManagerCode } = require("./managerAuth");
const { buildKnowledgeEntry, canExtractCustomQuestionAnswer } = require("./knowledgeNormalizer");
const { buildSalesSystemPrompt, buildDemoSystemPrompt } = require("../utils/salesPromptBuilder");
const { upsertLead, markLeadConverted } = require("./leadStore");
const { consumePendingConnectionByAdminPhone } = require("./dialogLink");
const { createTelegramConnectCode, getTelegramRecipients, removeTelegramRecipient } = require("./telegram");
const env = require("../config/env");
const {
  getOnboardingQuestionPlan,
  getQuestionByKey,
  isComplete,
  buildOnboardingSummary,
  buildProvisionPayload,
  resolveTopicQuestions,
} = require("./onboardingFlow");
const {
  ADMIN_IDLE,
  ADMIN_COLLECTING,
  ADMIN_CONFIRMING,
  ADMIN_REPLYING,
  ADMIN_SAVE_CONFIRM,
  ADMIN_KNOWLEDGE_INTENT_CLARIFY,
  ADMIN_ONBOARDING,
  ADMIN_ONBOARDING_CONFIRM,
  ADMIN_ONBOARDING_SKIP_SELECT,
  ADMIN_ONBOARDING_EDIT_SELECT,
  ADMIN_ONBOARDING_EDIT_ANSWER,
  ADMIN_FORGOT_CODE_VERIFY,
  ADMIN_LOGIN_ASK_RESTAURANT_ID,
  ADMIN_LOGIN_ASK_MANAGER_CODE,
  ADMIN_EVENT_OPTIONAL,
  ADMIN_EVENT_EDIT_SELECT,
  ADMIN_EVENT_EDIT_ANSWER,
  ADMIN_AWAITING_NUMBER_CONNECT,
  ADMIN_LEAD_SALES,
  ADMIN_LEAD_DEMO,
  getOrCreateAdminSession,
  pushAdminMessage,
  updateAdminSessionState,
  resetAdminSession,
} = require("./adminSession");
const { buildAdminClassifierPrompt, buildAdminSummary } = require("../utils/adminPromptBuilder");
const logger = require("../utils/logger");

const REQUIRED_FIELDS = {
  add_event: ["event_name", "date", "time"],
  update_hours: ["days", "hours_text"],
  update_kosher: ["kosher_type"],
  add_promotion: ["promotion_text"],
  add_custom: ["content"],
  update_custom: ["target_text", "content"],
  delete_item: ["target_text"],
};

const AUTH_TTL_MS = Number(env.ADMIN_AUTH_TTL_MINUTES || 5) * 60 * 1000;
const ADMIN_IDLE_TIMEOUT_MS = Number(env.ADMIN_SESSION_IDLE_TIMEOUT_MINUTES || 5) * 60 * 1000;
const ADMIN_MAX_MESSAGE_CHARS = Number(env.ADMIN_MAX_MESSAGE_CHARS || 1200);
const ADMIN_LOGIN_MAX_FAILURES = Number(env.ADMIN_LOGIN_MAX_FAILURES || 3);
const ADMIN_LOGIN_LOCK_MS = Number(env.ADMIN_LOGIN_LOCK_MINUTES || 10) * 60 * 1000;
const ADMIN_LOGIN_MIN_INTERVAL_MS = Number(env.ADMIN_LOGIN_MIN_INTERVAL_SECONDS || 2) * 1000;
const ONBOARDING_REQUIRED_KEYS = new Set(["venue_style", "name", "address", "phone_number", "hours", "payment", "manager_code"]);
const LAST_ADDED_KNOWLEDGE_TTL_MS = 10 * 60 * 1000;
const KNOWLEDGE_LIST_PAGE_SIZE = 20;
const KNOWLEDGE_LIST_CONTINUE_TTL_MS = 10 * 60 * 1000;
const DIALOG_INTEGRATION_ENABLED = Boolean(env.DIALOG_INTEGRATION_ENABLED);
const DIALOG_EMBEDDED_SIGNUP_URL = String(env.DIALOG_EMBEDDED_SIGNUP_URL || "").trim();
const PURCHASE_LINK = String(env.PURCHASE_LINK || "").trim();
const CONTRACT_LINK = String(env.CONTRACT_LINK || "").trim();
const SALES_PRODUCT_NAME = String(env.SALES_PRODUCT_NAME || "בוט AI למסעדות").trim() || "בוט AI למסעדות";
const SALES_PRODUCT_DESCRIPTION = String(env.SALES_PRODUCT_DESCRIPTION || "").trim();
const SALES_PRODUCT_PRICE = String(env.SALES_PRODUCT_PRICE || "").trim();
const SALES_PURCHASE_MESSAGE_BENEFITS = String(env.SALES_PURCHASE_MESSAGE_BENEFITS || "").trim();
const ADMIN_PRIVATE_RESET_CODE = String(env.ADMIN_PRIVATE_RESET_CODE || "").trim();

function extractJson(text) {
  const clean = (text || "").trim();
  try {
    return JSON.parse(clean);
  } catch (_err) {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(clean.slice(firstBrace, lastBrace + 1));
      } catch (_err2) {
        return null;
      }
    }
    return null;
  }
}

function normalizeYesNo(text) {
  const value = String(text || "").trim().toLowerCase();
  const yes = [
    "כן",
    "yes",
    "ok",
    "okay",
    "אוקיי",
    "אוקי",
    "בסדר",
    "סבבה",
    "אשר",
    "מאשר",
    "מאשרת",
    "יאללה",
    "בטח",
    "סגור",
  ];
  const no = ["לא", "no", "בטל", "תבטל", "לא רוצה", "דלג", "לא תודה", "עזוב"];
  if (yes.includes(value)) return "yes";
  if (no.includes(value)) return "no";
  return null;
}

function isSkipClarifyText(text) {
  const value = String(text || "").trim().toLowerCase();
  return ["דלג", "skip", "לא", "אין", "ללא", "לא תודה", "no"].includes(value);
}

function isCancelText(text) {
  const value = String(text || "").trim().toLowerCase();
  return ["בטל", "ביטול", "cancel", "עצור", "עצור תהליך"].includes(value);
}

function isLastAddedIntent(query) {
  const value = String(query || "").trim().toLowerCase();
  const tokens = ["הוספתי", "נשמר", "עכשיו", "לפני רגע", "איך זה נשמר", "תראה מה הוספתי", "מה הוספתי", "השאלה שהוספתי", "התשובה שהוספתי"];
  return tokens.some((t) => value.includes(t));
}

function isKnowledgeListContinueText(text) {
  const value = normalizeLooseText(text);
  if (!value) return false;
  if (/(עוד|המשך|השאר|הבאים|הבאות|continue|more)/i.test(value)
    && /(שלח|שלחי|תשלח|תשלחי|תראה|תראי|הראה|הראי|תביא|תביאי|תמשיך|תמשיכי|אפשר|עוד|המשך|continue|more)/i.test(value)) {
    return true;
  }
  return [
    "המשך",
    "תמשיך",
    "תמשיכי",
    "עוד",
    "עוד פרטים",
    "עוד שאלות",
    "את הכל",
    "הכל",
    "כל השאר",
    "תשלח הכל",
    "תשלחי הכל",
    "continue",
    "more",
  ].includes(value);
}

function getActiveKnowledgeListState(session) {
  const state = session?.collected_data?.knowledge_list_pagination;
  const expiresAt = Number(state?.expires_at || 0);
  if (!state || !expiresAt || expiresAt <= Date.now()) {
    return null;
  }
  return state;
}

function extractKnowledgeQueryFromManagerText(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const normalized = normalizeLooseText(raw);
  const prefixes = [
    "רציתי לשאול על",
    "אני רוצה לשאול על",
    "בא לי לשאול על",
    "רוצה לדעת מה רשום על",
    "אפשר לדעת מה רשום על",
    "אפשר לראות מה כתוב על",
    "מה שמור על",
    "תראה לי מה רשום על",
    "תראי לי מה רשום על",
    "מה רשום על",
    "מה כתוב על",
    "תציג לי את מה שרשום על",
    "אפשר לראות מה רשום על",
  ];
  const hit = prefixes.find((p) => normalized.includes(p));
  if (!hit) return "";
  const parts = normalized.split(hit);
  const tail = String(parts[1] || "").trim();
  return tail || raw;
}

function formatKnowledgeItemForManager(item, idx, total) {
  const explicitTopic = String(item?.topic_title || "").trim();
  const rawContent = String(item?.content || "").trim();
  const category = String(item?.category || "").trim();
  const colonIndex = rawContent.indexOf(":");
  const hasTopicPrefix = colonIndex > 0 && colonIndex < 80;
  const categoryLabels = {
    hours: "שעות פתיחה",
    address: "כתובת ומיקום",
    menu: "תפריט",
    reservation: "הזמנות",
    payment: "אמצעי תשלום",
    kosher: "כשרות",
    event: "אירועים",
    promotion: "מבצעים",
    custom: "מידע נוסף",
  };
  const topic = explicitTopic || (hasTopicPrefix
    ? rawContent.slice(0, colonIndex).trim()
    : categoryLabels[category] || `פריט ${idx + 1}`);
  const savedValue = hasTopicPrefix
    ? rawContent.slice(colonIndex + 1).trim()
    : rawContent;

  const prefix = total > 1 ? `• *${topic}:*` : `• *${topic}:*`;
  return `${prefix}\n${savedValue || "-"}`;
}

function getNextOnboardingQuestionKey(collectedData = {}) {
  const skipped = new Set(Array.isArray(collectedData.skipped_question_keys) ? collectedData.skipped_question_keys : []);
  const next = getOnboardingQuestionPlan(collectedData).find(
    (q) => !skipped.has(q.key) && !String(collectedData[q.key] || "").trim()
  );
  return next ? next.key : null;
}

function onboardingQuestionLabel(question) {
  if (!question) return "";
  return String(question.topic || question.text || question.key || "").trim();
}

function buildOnboardingReviewMessage(fieldKey, value, collectedData = {}) {
  const label = onboardingQuestionLabel(getQuestionByKey(fieldKey, collectedData)) || fieldKey;
  const safeValue = String(value || "").trim() || "אין";
  return [
    "כך אני שומר את התשובה לנושא הזה:",
    `• ${label}: ${safeValue}`,
    "זה תקין? (כן/לא)",
  ].join("\n");
}

async function getOnboardingQuestionTextByKey(fieldKey, collectedData = {}) {
  const question = getQuestionByKey(fieldKey, collectedData);
  const topic = onboardingQuestionLabel(question) || fieldKey;
  return composeOnboardingQuestion({
    fieldKey,
    topic,
    collectedData,
  });
}

async function getNextOnboardingQuestionText(collectedData = {}) {
  const key = getNextOnboardingQuestionKey(collectedData);
  if (!key) return null;
  return getOnboardingQuestionTextByKey(key, collectedData);
}

function onboardingAnswerLooksLikeLink(value) {
  return /^https?:\/\/\S+/i.test(String(value || "").trim()) || /^www\./i.test(String(value || "").trim());
}

function onboardingAnswerHasPhone(value) {
  return (String(value || "").match(/\d/g) || []).length >= 9;
}

function isOnboardingEditIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  return [
    "ערוך",
    "עריכה",
    "לערוך",
    "שנה",
    "לשנות",
    "תשנה",
    "לתקן",
    "תיקון",
    "אני רוצה לשנות",
    "רוצה לשנות",
    "בא לי לשנות",
    "צריך לשנות",
    "צריך לתקן",
    "תן לי לשנות",
    "אשנה",
    "edit",
    "update",
    "modify",
    "change",
  ].some((token) => value.includes(token));
}

function clearDependentOnboardingAnswers(collectedData = {}, changedKey, changedValue) {
  if (normalizeYesNo(changedValue) !== "no") return collectedData;
  if (!changedKey) return collectedData;

  const topicQuestions = resolveTopicQuestions();
  const pending = [changedKey];
  const keysToClear = new Set();

  while (pending.length > 0) {
    const sourceKey = pending.pop();
    topicQuestions
      .filter((q) => q.requires_yes_key === sourceKey)
      .forEach((q) => {
        if (!keysToClear.has(q.key)) {
          keysToClear.add(q.key);
          pending.push(q.key);
        }
      });
  }

  if (keysToClear.size === 0) return collectedData;

  const merged = { ...collectedData };
  keysToClear.forEach((key) => {
    merged[key] = "";
  });

  const attempts = { ...((merged && merged.irrelevant_attempts) || {}) };
  keysToClear.forEach((key) => {
    delete attempts[key];
  });
  merged.irrelevant_attempts = attempts;
  return merged;
}

function buildOnboardingAcknowledgement(fieldKey, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (fieldKey === "name") return `מעולה, רשמתי שהשם הוא ${raw}.`;
  if (fieldKey === "phone_number") return "קיבלתי את מספר הפניות ללקוחות.";
  if (fieldKey === "hours") return "מעולה, רשמתי את שעות הפעילות.";
  if (fieldKey === "holiday_hours") return "רשמתי גם את שעות החגים.";
  if (fieldKey === "address") return "הכתובת נרשמה.";
  if (fieldKey === "navigation_link") return "קיבלתי את קישור הניווט.";
  if (fieldKey === "parking_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש חניה ללקוחות." : "הבנתי, רשמתי שאין חניה ייעודית.";
  }
  if (fieldKey === "parking") return "מעולה, רשמתי את פרטי החניה.";
  if (fieldKey === "accessibility_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש נגישות." : "הבנתי, רשמתי שאין נגישות מלאה.";
  }
  if (fieldKey === "accessibility") return "רשמתי את נושא הנגישות.";
  if (fieldKey === "wifi_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש Wi‑Fi." : "הבנתי, רשמתי שאין Wi‑Fi ללקוחות.";
  }
  if (fieldKey === "wifi") return "רשמתי את פרטי ה-Wi‑Fi.";
  if (fieldKey === "kosher_enabled") {
    return raw === "כן" ? "מעולה, נרשמה כשרות." : "הבנתי, רשמתי שאין כשרות.";
  }
  if (fieldKey === "kosher") return "רשמתי את סוג הכשרות.";
  if (fieldKey === "menu_main") {
    return onboardingAnswerLooksLikeLink(raw) ? "קיבלתי את קישור התפריט הראשי." : "רשמתי את פרטי התפריט הראשי.";
  }
  if (fieldKey === "has_dessert_menu") {
    return raw === "כן" ? "מעולה, נרשמו גם קינוחים נפרדים." : "הבנתי, אין תפריט קינוחים נפרד.";
  }
  if (fieldKey === "menu_dessert") return "רשמתי גם את פרטי הקינוחים.";
  if (fieldKey === "kids_menu_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש תפריט ילדים." : "הבנתי, אין תפריט ילדים.";
  }
  if (fieldKey === "kids_menu") return "רשמתי את פרטי תפריט הילדים.";
  if (fieldKey === "alcohol_menu_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש תפריט אלכוהול." : "הבנתי, אין תפריט אלכוהול.";
  }
  if (fieldKey === "alcohol_menu") return "רשמתי את פרטי תפריט האלכוהול.";
  if (fieldKey === "deliveries_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש משלוחים." : "הבנתי, רשמתי שאין משלוחים.";
  }
  if (fieldKey === "deliveries_details") return "רשמתי את פרטי המשלוחים.";
  if (fieldKey === "deliveries_tracking") return "מעולה, רשמתי איך הלקוחות עוקבים אחרי משלוח.";
  if (fieldKey === "reservation_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שאפשר להזמין שולחן מראש." : "הבנתי, רשמתי שאין הזמנת שולחן מראש.";
  }
  if (fieldKey === "reservation") {
    if (onboardingAnswerLooksLikeLink(raw)) return "קיבלתי את קישור ההזמנות.";
    if (onboardingAnswerHasPhone(raw)) return "קיבלתי את מספר הטלפון להזמנות.";
    return "רשמתי את פרטי ההזמנה.";
  }
  if (fieldKey === "payment") return "מעולה, רשמתי את אמצעי התשלום.";
  if (fieldKey === "customer_club_enabled") {
    return raw === "כן" ? "מעולה, יש מועדון לקוחות." : "הבנתי, אין מועדון לקוחות כרגע.";
  }
  if (fieldKey === "customer_club") return "רשמתי את פרטי מועדון הלקוחות.";
  if (fieldKey === "gift_cards_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שאתם מקבלים גיפט קארד / BuyMe." : "הבנתי, כרגע אין גיפט קארד או BuyMe.";
  }
  if (fieldKey === "gift_cards") return "רשמתי את פרטי הגיפט קארד והשוברים.";
  if (fieldKey === "inhouse_events_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש אירועים במקום." : "הבנתי, כרגע אין אירועים קבועים במקום.";
  }
  if (fieldKey === "inhouse_events") return "רשמתי את פרטי האירועים במקום.";
  if (fieldKey === "inhouse_events_entry_fee") return "רשמתי את נושא תשלום הכניסה לאירועים.";
  if (fieldKey === "inhouse_events_guidelines") return "רשמתי את ההנחיות המיוחדות לאירועים.";
  if (fieldKey === "private_events_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שאפשר לעשות אירועים פרטיים." : "הבנתי, כרגע אין אירועים פרטיים.";
  }
  if (fieldKey === "private_events") return "רשמתי את פרטי האירועים הפרטיים.";
  if (fieldKey === "sports_broadcasts_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש שידורי ספורט." : "הבנתי, כרגע אין שידורי ספורט.";
  }
  if (fieldKey === "sports_broadcasts") return "רשמתי את פרטי שידורי הספורט.";
  if (fieldKey === "music_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש מוזיקה קבועה/הופעות." : "הבנתי, כרגע אין מוזיקה קבועה או הופעות.";
  }
  if (fieldKey === "music_style") return "רשמתי את סגנון ותוכנית המוזיקה.";
  if (fieldKey === "merchandise_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש מרצ'נדייז." : "הבנתי, כרגע אין מרצ'נדייז.";
  }
  if (fieldKey === "merchandise") return "רשמתי את פרטי המרצ'נדייז.";
  if (fieldKey === "lost_found_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש נוהל אבדות ומציאות." : "הבנתי, כרגע אין נוהל אבדות ומציאות מוגדר.";
  }
  if (fieldKey === "lost_found") return "רשמתי את נוהל האבדות והמציאות.";
  if (fieldKey === "security_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שיש אבטחה/מצלמות." : "הבנתי, כרגע אין פרטי אבטחה מיוחדים לציון.";
  }
  if (fieldKey === "security") return "רשמתי את פרטי האבטחה.";
  if (fieldKey === "hiring_enabled") {
    return raw === "כן" ? "מעולה, רשמתי שאתם מגייסים עובדים." : "הבנתי, כרגע אתם לא מגייסים עובדים.";
  }
  if (fieldKey === "hiring") return "רשמתי את פרטי הגיוס.";
  return "";
}

function collectMissingFields(action, data) {
  const required = REQUIRED_FIELDS[action] || [];
  return required.filter((field) => !data[field] || String(data[field]).trim() === "");
}

function formatMissingQuestions(action, missingFields) {
  const labels = {
    event_name: "מה שם האירוע?",
    date: "מה התאריך המדויק של האירוע?",
    time: "באיזו שעה האירוע מתחיל?",
    days: "לאילו ימים העדכון חל?",
    hours_text: "מה שעות הפתיחה החדשות?",
    kosher_type: "מה סוג הכשרות המעודכן?",
    promotion_text: "מה תיאור המבצע?",
    content: "מה הטקסט שתרצה להוסיף?",
    target_text: action === "update_custom" ? "איזה נושא או פריט קיים תרצה לעדכן?" : "מה הטקסט המדויק שתרצה למחוק?",
  };

  return [
    "כדי להשלים את העדכון חסרים לי הפרטים הבאים:",
    ...missingFields.map((field, index) => `${index + 1}. ${labels[field] || field}`),
  ].join("\n");
}

async function composeAdminReply({
  intent,
  context = {},
  hardFacts = {},
  tonePolicy,
  emergencyText,
  model = env.OPENAI_CHAT_MODEL,
  temperature = 0.6,
}) {
  return composeResponse({
    intent,
    context,
    hardFacts,
    tonePolicy: tonePolicy || [
      "אנושי, חם, קצר וישיר.",
      "לא רובוטי ולא תבניתי.",
      "עברית תקינה ודקדוק נכון, כולל התאמת פנייה לזכר/נקבה/יחיד/רבים לפי הלקוח.",
      "אם לא ברור המגדר מההודעה, להשתמש בניסוח נייטרלי כדי להימנע מטעויות.",
      "להימנע מניסוח מתורגם מאנגלית ולהעדיף ניסוח ישראלי טבעי.",
      "לשמור על פיסוק ברור ומשפטים קצרים, בלי עומס מיותר.",
      "לשמור על עקביות בפנייה לאורך כל ההודעה.",
      "להתאים אורך תשובה לאורך השאלה וההקשר.",
      "לא להשתמש תמיד ברשימות; לכתוב טבעי כמו וואטסאפ כשמתאים.",
      "להתייחס למה שכבר נאמר קודם בשיחה.",
      "אם חסר מידע - לציין שחסר ולהציע צעד הבא.",
    ],
    language: "he",
    options: {
      apiKey: env.ADMIN_OPENAI_API_KEY || env.OPENAI_API_KEY,
      model,
      temperature,
      emergencyText: emergencyText || "יש תקלה רגעית, נסה שוב בעוד רגע.",
    },
  });
}

async function sendAdminTextMessage(adminPhone, text, metadata = {}) {
  const rawText = String(text || "").trim();
  if (!rawText) {
    return sendAdminTextMessageRaw(adminPhone, "יש תקלה רגעית, נסה שוב בעוד רגע.");
  }
  const composed = await composeAdminReply({
    intent: metadata.intent || "admin_message",
    context: metadata.context || {},
    hardFacts: {
      source_message: rawText,
      ...(metadata.hardFacts || {}),
    },
    emergencyText: rawText,
    model: metadata.model || env.OPENAI_CHAT_MODEL,
    temperature: typeof metadata.temperature === "number" ? metadata.temperature : 0.6,
  });
  return sendAdminTextMessageRaw(adminPhone, composed);
}

async function sendAdminButtons({ to, bodyText, buttons, intent = "admin_button_prompt", context = {}, hardFacts = {} }) {
  const composedBody = await composeAdminReply({
    intent,
    context,
    hardFacts: {
      source_message: String(bodyText || ""),
      ...(hardFacts || {}),
    },
    emergencyText: String(bodyText || ""),
    model: env.OPENAI_CHAT_MODEL,
  });
  return sendInteractiveButtons({
    to,
    bodyText: composedBody,
    buttons,
  });
}

function buildKnowledgeContent(action, data) {
  if (action === "add_event") {
    return [
      `אירוע: ${data.event_name}`,
      `תאריך: ${data.date}`,
      `שעה: ${data.time}`,
      `מחיר: ${data.ticket_price || "לא צוין"}`,
      `הזמנה מראש: ${data.reservation_required || "לא צוין"}`,
      `פרטים נוספים: ${data.details || "אין"}`,
    ].join("\n");
  }
  if (action === "update_hours") {
    return `שעות פתיחה מעודכנות\nימים: ${data.days}\nשעות: ${data.hours_text}`;
  }
  if (action === "update_kosher") {
    return `כשרות\nסוג: ${data.kosher_type}\nגוף משגיח: ${data.supervisor || "לא צוין"}`;
  }
  if (action === "add_promotion") {
    return `מבצע\n${data.promotion_text}\nתוקף עד: ${data.end_date || "לא צוין"}`;
  }
  if (action === "add_custom") {
    return data.content;
  }
  if (action === "update_custom") {
    return data.content;
  }
  return "";
}

function categoryForAction(action) {
  if (action === "add_event") return "event";
  if (action === "update_hours") return "hours";
  if (action === "update_kosher") return "kosher";
  if (action === "add_promotion") return "promotion";
  return "custom";
}

function adminIntentRecentMessages(session = {}) {
  return (Array.isArray(session.messages) ? session.messages : [])
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 900),
    }));
}

function adminIntentContextData(session = {}, baseCollectedData = {}) {
  const collectedData = {
    ...(baseCollectedData || {}),
  };
  const activeKnowledgeList = getActiveKnowledgeListState(session);
  if (activeKnowledgeList) {
    collectedData.knowledge_list_pagination = {
      active: true,
      next_offset: Number(activeKnowledgeList.next_offset || 0),
      total: Number(activeKnowledgeList.total || 0),
      page_size: Number(activeKnowledgeList.page_size || KNOWLEDGE_LIST_PAGE_SIZE),
    };
  }
  if (session.pending_action) {
    collectedData.current_pending_action = session.pending_action;
  }
  if (session.state) {
    collectedData.current_state = session.state;
  }
  return collectedData;
}

async function parseAdminIntent(messageText, pendingAction = null, collectedData = {}, recentMessages = []) {
  const messages = buildAdminClassifierPrompt({
    messageText,
    pendingAction,
    collectedData,
    recentMessages,
  });
  const raw = await chatCompletion(messages, {
    apiKey: env.ADMIN_OPENAI_API_KEY || env.OPENAI_API_KEY,
    model: env.ADMIN_OPENAI_CHAT_MODEL,
    temperature: 0.3,
  });
  const parsed = extractJson(raw);
  if (!parsed || !parsed.action) {
    return { action: "unknown", fields: {} };
  }
  const actionForNormalization = parsed.action && parsed.action !== "unknown" ? parsed.action : pendingAction;
  const normalizedFields = normalizeAdminParsedFields(actionForNormalization, parsed.fields || {});
  return {
    action: parsed.action,
    fields: normalizedFields,
  };
}

async function generateAdminGeneralReply({ messageText, restaurantName }) {
  const reply = await composeResponse({
    intent: "admin_general_reply",
    context: {
      restaurant_name: restaurantName || "",
      message: String(messageText || ""),
      available_examples: [
        "מה יש לי עכשיו?",
        "הוסף אירוע",
        "שנה שעות פתיחה",
        "עדכן כשרות",
        "עדכן תפריט",
        "הוסף מבצע",
        "מחק פריט",
        "חבר טלגרם",
      ],
      instruction:
        "אם הנושא מחוץ לתחום הניהול (פוליטיקה/דת/חדשות/רפואה/משפט/כללי) - דחייה קצרה מנומסת ואז הכוונה חזרה לניהול העסק.",
    },
    hardFacts: {},
    tonePolicy: [
      "עברית טבעית, קצרה וחמה.",
      "לא ניסוח רובוטי.",
      "להציע לפחות פעולת ניהול אחת רלוונטית.",
    ],
    language: "he",
    options: {
    apiKey: env.ADMIN_OPENAI_API_KEY || env.OPENAI_API_KEY,
    model: env.ADMIN_OPENAI_CHAT_MODEL,
    temperature: 0.6,
      emergencyText: "אפשר לנסות שוב בעוד רגע, או לכתוב פעולה כמו: הוסף אירוע / שנה שעות פתיחה.",
    },
  });
  return String(reply || "").trim();
}

async function findRestaurantByAdminPhone(phoneNumber) {
  const snap = await db.collection("restaurants").where("admin_phone", "==", phoneNumber).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function findRestaurantById(restaurantId) {
  const id = String(restaurantId || "").trim();
  if (!id) return null;
  const ref = db.collection("restaurants").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

function parseLoginCommand(text) {
  const match = String(text || "").trim().match(/^כניסה\s+([^\s]+)\s+(.+)$/);
  if (!match) return null;
  return { restaurantId: match[1].trim(), managerCode: match[2].trim() };
}

function isForgotCodeIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  return ["שכחתי קוד", "שחזור קוד", "forgot code", "reset code"].includes(value);
}

function isLoginStartIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  return ["כניסה", "התחברות", "login", "sign in", "יש לי עסק", "להתחבר"].includes(value);
}

function isLoginState(state) {
  return state === ADMIN_LOGIN_ASK_RESTAURANT_ID || state === ADMIN_LOGIN_ASK_MANAGER_CODE;
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function sanitizeAdminText(text) {
  return String(text || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lockInfo(collectedData = {}) {
  const until = Number(collectedData.locked_until || 0);
  const now = Date.now();
  return {
    isLocked: until > now,
    lockedUntil: until,
  };
}

async function escalateForgotCodeToHuman({ adminPhone, restaurantId, reason }) {
  if (!env.ADMIN_WHATSAPP_NUMBER) {
    return;
  }
  const notify = [
    "בקשת שחזור קוד מנהל דורשת טיפול ידני",
    `טלפון פונה: ${adminPhone}`,
    `מזהה עסק: ${restaurantId || "לא סופק"}`,
    `סיבה: ${reason || "לא ידוע"}`,
    `זמן: ${new Date().toISOString()}`,
  ].join("\n");
  await sendAdminTextMessageRaw(env.ADMIN_WHATSAPP_NUMBER, notify);
}

function isAuthValid(session) {
  const ts = Number(session?.collected_data?.auth_at || 0);
  const restaurantId = session?.collected_data?.authenticated_restaurant_id;
  return Boolean(restaurantId && ts > 0 && Date.now() - ts <= AUTH_TTL_MS);
}

function isSessionIdleExpired(session) {
  const messages = session?.messages || [];
  const lastTs = messages.length > 0 ? Number(messages[messages.length - 1]?.ts || 0) : 0;
  if (!lastTs) return false;
  return Date.now() - lastTs > ADMIN_IDLE_TIMEOUT_MS;
}

const IDLE_MANAGER_CODE_MESSAGES = [
  "עקב היעדר פעילות בפרק הזמן האחרון, החיבור נותק. להתחברות מחודשת יש להזין קוד מנהל.",
  "הסשן פג בשל חוסר פעילות. להמשך ניהול העסק, נא להזין קוד מנהל.",
  "נותקת מהסשן לאחר מספר דקות ללא פעילות. כדי להתחבר מחדש, הזן קוד מנהל.",
  "מפאת אי-פעילות, ההתחברות הנוכחית הסתיימה. אנא הזן קוד מנהל לצורך התחברות מחדש.",
  "ההפעלה הופסקה זמנית עקב חוסר פעילות. להמשך עבודה יש להזין קוד מנהל.",
  "חלף פרק זמן ללא פעילות ולכן הסשן נסגר. להתחברות מחודשת נדרש קוד מנהל.",
  "מטעמי אבטחה, הסשן נותק לאחר אי-פעילות. הזן קוד מנהל כדי לשוב למערכת.",
  "תוקף הסשן הסתיים מאחר שלא זוהתה פעילות. להמשך, יש להזין קוד מנהל.",
  "החיבור נותק אוטומטית בעקבות היעדר פעילות. לצורך התחברות מחדש, הזן קוד מנהל.",
  "לא זוהתה פעילות בזמן האחרון ולכן נותקת. להתחברות מחודשת יש להזין קוד מנהל.",
];

function pickIdleManagerCodeMessage() {
  const idx = Math.floor(Math.random() * IDLE_MANAGER_CODE_MESSAGES.length);
  return IDLE_MANAGER_CODE_MESSAGES[idx] || IDLE_MANAGER_CODE_MESSAGES[0];
}

function isAffirmativeLeadIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  return ["כן", "yes", "בטח", "יאללה", "סבבה", "ברור", "מעוניין", "מעוניינת"].includes(value);
}

function isDemoKickoffIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  return [
    "כן",
    "yes",
    "יאללה",
    "סבבה",
    "ברור",
    "בוא נתחיל",
    "בואי נתחיל",
    "נתחיל",
    "תתחיל",
    "תתחילי",
    "קדימה",
  ].includes(value);
}

function isNegativeLeadIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  return ["לא", "no", "לא מעוניין", "לא מעוניינת", "לא כרגע", "עזוב"].includes(value);
}

function isDemoIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  return /(הדגמ|דמו|תדגים|להדגים|simulate|demo)/.test(value);
}

function isDemoExitIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  return /(רוצה לצאת מהדגמה|לצאת מהדגמה|צא מהדגמה|יציאה מהדגמה|אפשר לצאת מהדגמה|סיום הדגמה|סיים הדגמה|בוא נסיים (את )?הדגמה|אפשר לסיים( את)? ההדגמה|התרשמתי מספיק|הספיק לי|מספיק לי|נעבור לרכישה|אפשר הצעה|נראה מגניב|וואי מגניב|טוב מגניב)/.test(value);
}

function normalizeDemoBusinessType(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return "מסעדה";
  if (/(בר|bar|פאב|pub)/.test(value)) return "בר";
  if (/(קפה|בית קפה|cafe|coffee|קופי)/.test(value)) return "בית קפה";
  return "מסעדה";
}

function parseTelegramAdminCommand(text) {
  const value = String(text || "").trim();
  const normalized = normalizeLooseText(value);
  if (!/(טלגרם|telegram)/i.test(value)) return null;
  if (/(רשימה|הצג|מה מחובר|מי מחובר|סטטוס|מחוברים)/.test(normalized)) {
    return { action: "list" };
  }
  const removeMatch = value.match(/(?:מחק|הסר|נתק|remove)\s+(?:טלגרם\s+)?(-?\d+)/i);
  if (removeMatch) {
    return { action: "remove", chatId: removeMatch[1] };
  }
  if (/(חבר|הוסף|connect|add|איך)/i.test(value)) {
    return { action: "instructions" };
  }
  return null;
}

function buildTelegramInstructions(connectCode = "") {
  return [
    "*חיבור התראות טלגרם לנציגים:*",
    "1. פתח קבוצת טלגרם לנציגי העסק.",
    "2. הוסף לקבוצה את בוט הטלגרם של המערכת.",
    "3. כשהבוט מבקש קוד, שלח בקבוצה את הקוד הזה:",
    connectCode ? `\`${connectCode}\`` : "`בקש קוד חדש מבוט הניהול`",
    "",
    "זה קוד חיבור לטלגרם בלבד, והוא נפרד מקוד הניהול.",
    "אחרי החיבור, כל פנייה לנציג תישלח לטלגרם עם כפתור: טופל, החזר בוט.",
  ].join("\n");
}

function buildTelegramRecipientsList(restaurant) {
  const recipients = getTelegramRecipients(restaurant);
  if (recipients.length === 0) {
    return "לא מחובר כרגע אף צ'אט טלגרם להתראות נציג.";
  }
  const rows = recipients.map((recipient, idx) => {
    const title = recipient.title ? ` (${recipient.title})` : "";
    return `${idx + 1}. ${recipient.chat_id}${title}`;
  });
  return ["*צ'אטים שמקבלים התראות טלגרם:*", ...rows].join("\n");
}

function demoStyleKeyFromBusinessType(type) {
  const normalized = normalizeDemoBusinessType(type);
  if (normalized === "בר") return "bar";
  if (normalized === "בית קפה") return "cafe";
  return "restaurant";
}

const DEMO_FAQ_SAMPLE_ANSWERS = {
  hours: "אנחנו פתוחים א'-ה' 12:00-23:00, שישי 12:00-16:00, ובמוצ\"ש שעה אחרי צאת שבת עד 00:30.",
  holiday_hours: "בחגים אנחנו מעדכנים שעות ייעודיות מראש. הכי בטוח לבדוק כאן ביום שלפני החג.",
  address: "אנחנו ברחוב הדגמה 12, תל אביב, קומה קרקע.",
  navigation_link: "ניווט מהיר: https://maps.google.com/?q=Demo+Restaurant+Tel+Aviv",
  parking_enabled: "כן, יש חניה נוחה ללקוחות.",
  parking: "יש חניון ציבורי צמוד ועוד חניה כחול-לבן ברחובות הסמוכים.",
  seating_climate: "יש ישיבה פנימית ממוזגת וישיבה חיצונית עם מאווררים וחימום לפי עונה.",
  seating_areas: "יש אזור פנים, אזור חוץ ואזור שקט לקבוצות קטנות.",
  accessibility_enabled: "כן, יש נגישות.",
  accessibility: "יש כניסה נגישה, שירותי נכים ומעבר נוח לעגלות.",
  medical_kit: "יש ערכת עזרה ראשונה זמינה לצוות, ובמקרה אלרגיה אנחנו נותנים מענה מידי.",
  baby_changing: "יש פינת החתלה בשירותים.",
  kosher_enabled: "כן, יש כשרות.",
  kosher: "כשרות: כשר חלבי, כולל תעודה בתוקף.",
  wifi_enabled: "כן, יש Wi‑Fi.",
  wifi: "כן, יש Wi-Fi חופשי לאורחים.",
  promotions: "יש מבצעים מתחלפים באמצע שבוע ובשעות שקטות.",
  happy_hour: "האפי האוור בימים א'-ה' בין 17:00 ל-19:00 על משקאות נבחרים.",
  customer_club_enabled: "כן, יש מועדון לקוחות.",
  customer_club: "יש מועדון לקוחות עם הטבות תקופתיות וקופונים אישיים.",
  discounts: "יש הנחות לסטודנטים וחיילים בהצגת תעודה.",
  birthday_benefits: "ביום הולדת יש הטבה משתנה, בדרך כלל קינוח/קוקטייל עלינו.",
  specials: "יש ספיישלים שבועיים שמתעדכנים לפי חומרי גלם עונתיים.",
  gift_cards_enabled: "כן, אפשר לשלם בגיפט קארד / BuyMe.",
  gift_cards: "מכבדים שוברים וגיפט קארד, כולל BuyMe לפי תנאי השובר.",
  menu_main: "יש תפריט אוכל מלא, ואפשר לשלוח לינק עדכני או להמליץ על מנות מרכזיות.",
  has_dessert_menu: "כן, יש תפריט קינוחים נפרד.",
  menu_dessert: "יש תפריט קינוחים נפרד, ואפשר לשלוח לינק או פירוט קינוחים מובילים.",
  kids_menu_enabled: "כן, יש תפריט ילדים.",
  kids_menu: "יש תפריט ילדים עם מנות עדינות ואופציות לחלוקה.",
  alcohol_menu_enabled: "כן, יש תפריט אלכוהול.",
  alcohol_menu: "יש תפריט אלכוהול עם בירות, יינות וקוקטיילים.",
  business_lunch_brunch: "יש עסקיות צהריים ובחלק מהימים גם בראנץ' ייעודי.",
  vegan_vegetarian: "יש מגוון מנות טבעוניות וצמחוניות.",
  gluten_free: "יש מנות ללא גלוטן, עם דגש על עבודה זהירה במטבח.",
  allergy_info: "לגבי אלרגנים - הצוות מעודכן ויכול לכוון לפי רכיבים לפני הזמנה.",
  milk_types: "יש חלב רגיל וגם חלופות כמו סויה, שיבולת ושקדים.",
  deliveries_enabled: "כן, יש משלוחים.",
  deliveries_details: "המשלוחים עובדים דרך הפלטפורמות המובילות, עם כיסוי לאזורים מרכזיים סביב העסק.",
  deliveries_tracking: "הלקוח מקבל עדכוני סטטוס דרך האפליקציה/לינק מעקב של פלטפורמת המשלוחים.",
  reservation_enabled: "כן, ניתן להזמין שולחן מראש.",
  reservation: "הזמנת שולחן בטלפון או דרך קישור הזמנות ייעודי.",
  large_group_reservation: "לקבוצות גדולות מומלץ לתאם מראש כדי לשריין אזור מתאים.",
  cancellation_fee: "במקרים מסוימים יש מדיניות ביטול, תלוי סוג ההזמנה וגודל הקבוצה.",
  reservation_deposit: "בהזמנות גדולות/אירועים לעיתים נדרש פיקדון לאישור הסגירה.",
  inhouse_events_enabled: "כן, יש אירועים קבועים במקום.",
  inhouse_events: "יש אירועים בעסק מעת לעת, כולל הופעות וערבי קונספט.",
  inhouse_events_entry_fee: "בחלק מהאירועים יש תשלום כניסה, ובאחרים הכניסה חופשית.",
  inhouse_events_guidelines: "בחלק מהאירועים יש מגבלת גיל והגעה מוקדמת מומלצת.",
  private_events_enabled: "כן, אפשר לקיים אירועים פרטיים.",
  private_events: "אפשר לסגור אירועים פרטיים, כולל אזור ייעודי בהתאם לגודל הקבוצה.",
  sports_broadcasts_enabled: "כן, משדרים שידורי ספורט.",
  sports_broadcasts: "משדרים משחקים מרכזיים באווירה חיה.",
  music_enabled: "כן, יש מוזיקה קבועה.",
  music_style: "המוזיקה משתנה לפי יום ושעה, בדרך כלל קו עדכני ונעים.",
  age_restriction: "בחלק מהשעות/אירועים יש מגבלת גיל בהתאם למדיניות המקום.",
  smoking_policy: "עישון מותר רק באזור ייעודי בחוץ, לא באזור הפנימי.",
  dress_code: "אין קוד לבוש קשיח, אבל בערבי אירוע מומלץ להגיע בלבוש מסודר.",
  chaser_deals: "יש דילים על צ'ייסרים ובקבוקים בזמנים נבחרים.",
  corkage_fee: "יש דמי חליצה לפי סוג הבקבוק ומדיניות ערב.",
  payment: "מכבדים אשראי, Apple Pay ו-Google Pay.",
  cibus_10bis: "עובדים עם סיבוס/תן ביס בשעות הפעילות הרלוונטיות למשלוחים.",
  merchandise_enabled: "כן, יש מרצ'נדייז.",
  lost_found: "אבדות ומציאות: אפשר לפנות אלינו ונבדוק לפי תיאור החפץ.",
  lost_found_enabled: "כן, יש נוהל אבדות ומציאות.",
  security_enabled: "כן, יש אבטחה ומצלמות.",
  hiring_enabled: "לא, כרגע לא מגייסים עובדים.",
  merchandise: "יש מרצ'נדייז נבחר לרכישה במקום.",
  security: "יש מערך אבטחה לפי צורך ובהתאם לנהלי המקום.",
  hiring: "אנחנו מגייסים מעת לעת, אפשר לשלוח פרטים ונחזור אליך.",
  human_representative: "בטח, אפשר להעביר לנציג אנושי שיטפל אישית.",
  receipt_feedback: "אפשר לבקש העתק קבלה וגם לשלוח משוב כדי שנשתפר.",
};

function buildDemoFaqExamples(businessType) {
  const styleKey = demoStyleKeyFromBusinessType(businessType);
  const topics = resolveTopicQuestions().filter(
    (q) => Array.isArray(q.askFor) && q.askFor.includes(styleKey)
  );
  return topics.map((q) => {
    const topic = String(q.topic || q.text || q.key || "").trim();
    const sample = DEMO_FAQ_SAMPLE_ANSWERS[q.key]
      || `לגבי ${topic}: יש אצלנו מענה מסודר, ואני יכול לפרט לפי מה שרלוונטי לך.`;
    return { topic, sample };
  });
}

function isFullDemoFaqRequest(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  return /(כל(ל)? השאלות|כל השאלות|דוגמא(ות)? לכל השאלות|כל השאלות והתשובות|הכל מרוכז|רשימה מלאה|מלא של השאלות|כל מה שאפשר לשאול)/.test(value);
}

function isDemoFaqExamplesRequest(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  return /(דוגמא(ות)? לשאלות|דוגמה לשאלות|דוגמה מה אפשר לשאול|מה אפשר לשאול|faq|שאלות נפוצות|תן כמה שאלות|דוגמ(ה|אות))/i.test(value);
}

function buildDemoFaqMessage({ businessType, items }) {
  const title = `מעולה, הנה דוגמה מסודרת לשאלות נפוצות עבור ${businessType}:`;
  const rows = items.map((item, idx) => `${idx + 1}. ${item.topic}\nתשובה לדוגמה: ${item.sample}`);
  return [title, ...rows].join("\n\n");
}

function buildDemoFaqExamplesMessage({ businessType, items }) {
  const title = `מעולה, הנה כמה דוגמאות לשאלות שלקוחות בדרך כלל שואלים ב${businessType}:`;
  const rows = items.map((item, idx) => `${idx + 1}. ${item.topic}\nתשובה לדוגמה: ${item.sample}`);
  return [title, ...rows].join("\n\n");
}

function pickDemoFaqExamples(items, max = 6) {
  const list = Array.isArray(items) ? items : [];
  if (list.length <= max) return list;
  return list.slice(0, max);
}

function splitLongMessage(text, maxChars = 3400) {
  const value = String(text || "");
  if (value.length <= maxChars) return [value];
  const parts = value.split(/\n\n+/);
  const chunks = [];
  let current = "";
  for (const part of parts) {
    const candidate = current ? `${current}\n\n${part}` : part;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = "";
    }
    if (part.length <= maxChars) {
      current = part;
      continue;
    }
    // Hard split oversized part if needed.
    for (let i = 0; i < part.length; i += maxChars) {
      chunks.push(part.slice(i, i + maxChars));
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function inferDemoIntentFromContext({ session, text }) {
  const userText = String(text || "").trim();
  if (!userText) return false;

  const history = (session?.messages || [])
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    }))
    .slice(-8);

  const messages = [
    {
      role: "system",
      content: [
        "אתה מסווג כוונת משתמש בשיחת מכירה בוואטסאפ.",
        "המטרה: לזהות אם המשתמש מבקש לראות הדגמה חיה/בדיקה בפועל של הבוט.",
        "התייחס גם לביטויים עקיפים כמו: 'אשמח לבדוק', 'בוא נראה', 'תראה איך זה עובד', 'יאללה נבדוק'.",
        "אם המשתמש רק שואל מחיר/חוזה/רכישה/תשלום - זו לא בקשת הדגמה.",
        "אם לא בטוח - החזר false.",
        "החזר JSON בלבד בפורמט: {\"wants_demo\": true|false}",
      ].join("\n"),
    },
    ...history,
    { role: "user", content: userText },
  ];

  try {
    const raw = await chatCompletion(messages, {
      apiKey: env.ADMIN_OPENAI_API_KEY || env.OPENAI_API_KEY,
      model: env.ADMIN_OPENAI_CHAT_MODEL,
      temperature: 0,
      fallbackText: "{\"wants_demo\": false}",
    });
    const parsed = extractJson(raw);
    return Boolean(parsed && parsed.wants_demo === true);
  } catch (_error) {
    return false;
  }
}

function businessTypeWithArticle(type) {
  const v = String(type || "").trim();
  if (v === "בר") return "הבר";
  if (v === "מסעדה") return "המסעדה";
  if (v === "בית קפה") return "בית הקפה";
  return "העסק";
}

async function inferDemoExitFromContext({ session, text }) {
  const userText = String(text || "").trim();
  if (!userText) return false;

  const history = (session?.messages || [])
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    }))
    .slice(-8);

  const messages = [
    {
      role: "system",
      content: [
        "אתה מסווג כוונת משתמש בתוך מצב הדגמה חיה של בוט מסעדה.",
        "המטרה: לזהות אם המשתמש מבקש לצאת מהדגמה ולעבור חזרה לשיחת מכירה/הצעה.",
        "התייחס גם לביטויים עקיפים כמו: 'נראה מגניב', 'טוב מגניב', 'אפשר לסיים', 'התרשמתי', 'יאללה ממשיכים לרכישה'.",
        "אם המשתמש ממשיך לשאול שאלות על המסעדה - זו לא יציאה מהדגמה.",
        "אם לא בטוח - החזר false.",
        "החזר JSON בלבד בפורמט: {\"exit_demo\": true|false}",
      ].join("\n"),
    },
    ...history,
    { role: "user", content: userText },
  ];

  try {
    const raw = await chatCompletion(messages, {
      apiKey: env.ADMIN_OPENAI_API_KEY || env.OPENAI_API_KEY,
      model: env.ADMIN_OPENAI_CHAT_MODEL,
      temperature: 0,
      fallbackText: "{\"exit_demo\": false}",
    });
    const parsed = extractJson(raw);
    return Boolean(parsed && parsed.exit_demo === true);
  } catch (_error) {
    return false;
  }
}

function isPurchaseIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  return /(רכיש|לקנות|להצטרף|הצטרפות|תשלום|מחיר|חבילה|purchase|buy|pricing|price)/.test(value);
}

function isBusinessAdoptionIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  return /(איך עושים לעסק שלי|איך זה עובד לעסק שלי|איך מחברים|איך מתחילים|איך מקימים|איך מתקינים|איך מצטרפים|מה השלבים|לעסק שלי|אצלי בעסק|רוצה בעסק שלי|איך רוכשים|איך קונים|איך זה עובד אצלי|איך זה יעבוד אצלי|איך מטמיעים|איך מפעילים את זה בעסק|איך מכניסים את זה לעסק|מה צריך כדי להתחיל|מה צריך ממני כדי להתחיל|איך מתקדמים מכאן|יאללה בוא נתקדם|בוא נתקדם לעסקה|אפשר להתחיל תהליך|תשלח לי פרטי רכישה|שלח לי את הקישור לרכישה|אפשר קישור לרכישה|איך סוגרים את זה|איך סוגרים עסקה|בא לי את זה לעסק|רוצה שזה יעבוד גם אצלי|איך עושים שזה יעבוד אצלי|מה השלב הבא|מה הצעד הבא|איך עוברים לפרקטיקה|סבבה איך מתקדמים)/.test(value);
}

function isConnectDoneIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  return ["מוכן", "סיימתי", "בוצע", "done", "ready", "connected"].includes(value);
}

function isPotentialInviteCode(text) {
  const value = String(text || "").trim();
  return /^[A-Za-z0-9]{5,12}$/.test(value);
}

function normalizeSecretCode(text) {
  return String(text || "").trim().toUpperCase();
}

function isPrivateResetCode(text) {
  const configuredCode = normalizeSecretCode(ADMIN_PRIVATE_RESET_CODE);
  if (!configuredCode) return false;
  return normalizeSecretCode(text) === configuredCode;
}

function extractInviteCodeCandidate(text) {
  const value = String(text || "").trim().toUpperCase();
  if (!value) return "";
  const candidates = value.match(/[A-Z0-9]{5,12}/g) || [];
  return candidates[0] || "";
}

function isInviteCodeHelpIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return false;
  return /(יש לי קוד|קוד הזמנה|מה עושים עם הקוד|מה עושים איתו|איך משתמשים בקוד|לאן לשלוח את הקוד|איך ממשיכים עם הקוד|קיבלתי קוד)/.test(value);
}

function leadStage(session) {
  return String(session?.collected_data?.lead_stage || "").trim();
}

function parsePurchaseBenefits(rawBenefits = "") {
  return String(rawBenefits || "")
    .split(/\n|\|\||;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function buildLeadPurchaseMessage() {
  const configuredBenefits = parsePurchaseBenefits(SALES_PURCHASE_MESSAGE_BENEFITS);
  const defaultBenefits = [
    "בוט וואטסאפ חכם לעסק עם מענה אוטומטי ללקוחות.",
    "ניהול ועדכון ידע דרך בוט הניהול בצורה מהירה.",
    "העברת שיחה לנציג אנושי כשצריך.",
  ];
  const benefits = configuredBenefits.length > 0
    ? configuredBenefits
    : (SALES_PRODUCT_DESCRIPTION ? [SALES_PRODUCT_DESCRIPTION] : defaultBenefits);

  const lines = [
    "מעולה, נשמח להתקדם איתך לרכישה.",
    `ברכישה של ${SALES_PRODUCT_NAME} תקבל/י:`,
    ...benefits.map((item) => `- ${item}`),
    `מחיר: ${SALES_PRODUCT_PRICE || "יימסר בשיחת סגירה קצרה."}`,
    `לתשלום: ${PURCHASE_LINK || "קישור תשלום יישלח כאן מיד אחרי אישור סופי."}`,
    `לחוזה: ${CONTRACT_LINK || "קישור חוזה יישלח כאן מיד אחרי אישור סופי."}`,
  ];
  return lines.join("\n");
}

async function composeLeadSalesReply({ session, text, mode = "sales", flowInstruction = "" }) {
  const history = (session.messages || [])
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") }))
    .slice(-8);
  const systemPrompt = mode === "demo"
    ? buildDemoSystemPrompt({
      demoRestaurantData: env.SALES_DEMO_RESTAURANT_DATA,
      businessType: session?.collected_data?.demo_business_type || "",
    })
    : buildSalesSystemPrompt({
      productName: SALES_PRODUCT_NAME,
      productDescription: SALES_PRODUCT_DESCRIPTION,
      purchaseLink: PURCHASE_LINK,
      contractLink: CONTRACT_LINK,
    });
  const messages = [
    { role: "system", content: systemPrompt },
    ...(flowInstruction ? [{ role: "system", content: String(flowInstruction || "").trim() }] : []),
    ...history,
    { role: "user", content: String(text || "") },
  ];

  return chatCompletion(messages, {
    apiKey: env.ADMIN_OPENAI_API_KEY || env.OPENAI_API_KEY,
    model: env.ADMIN_OPENAI_CHAT_MODEL,
    temperature: 0.7,
    fallbackText: "בשמחה. אשמח להבין מה חשוב לך בבוט כדי שאכוון אותך מדויק.",
  });
}

async function composeLeadIntroMessage() {
  const styleHints = [
    "ישיר וחם",
    "קצר ובטוח",
    "ידידותי וקליל",
    "ענייני ומזמין",
  ];
  const styleHint = styleHints[Math.floor(Math.random() * styleHints.length)];
  const variationSeed = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  return composeAdminReply({
    intent: "lead_intro_message",
    context: {
      goal: "פתיחת שיחה לליד חדש בבוט מנהל",
      style_hint: styleHint,
      variation_seed: variationSeed,
    },
    hardFacts: {
      instruction: [
        "כתוב הודעת פתיחה קצרה, טבעית ונעימה בעברית תקינה.",
        "המסר המרכזי: אתה כאן כדי לעזור לשמוע על הצ'אט החכם שלנו (בוט וואטסאפ לעסק).",
        "שאל אם מעניין לשמוע, ואם יש קוד הזמנה אפשר לשלוח אותו כאן.",
        "הימנע מניסוח רובוטי ואל תחזור מילה במילה על נוסח קבוע.",
        "פתח כל פעם בצורה מעט שונה כדי לייצר גיוון טבעי.",
      ].join(" "),
    },
    tonePolicy: [
      "אנושי, חם וקצר.",
      "עברית תקינה וברורה.",
      "לא ניסוח תבניתי קשיח.",
    ],
    emergencyText: "היי, אני כאן כדי לעזור לך לשמוע על הצ'אט החכם שלנו. מעניין? אם יש לך קוד הזמנה אפשר לשלוח כאן.",
    model: env.OPENAI_CHAT_MODEL,
    temperature: 0.7,
  });
}

async function startLeadSalesIntro({ session, adminPhone, resetConversation = false }) {
  const leadIntro = String(await composeLeadIntroMessage() || "").trim();
  await upsertLead({ phone: adminPhone, stage: "awaiting_interest" });
  await updateAdminSessionState(session.id, {
    state: ADMIN_LEAD_SALES,
    pending_action: "lead_sales",
    collected_data: {
      lead_stage: "awaiting_interest",
    },
    restaurant_id: "__onboarding__",
    ...(resetConversation ? { messages: [] } : {}),
  });
  await sendAdminTextMessageRaw(adminPhone, leadIntro);
  await pushAdminMessage(session.id, "assistant", leadIntro);
}

async function composeLeadIdleRestartMessage() {
  const styleHints = [
    "חם ומרגיע",
    "ישיר וקצר",
    "שירותי וידידותי",
    "ענייני וקליל",
  ];
  const styleHint = styleHints[Math.floor(Math.random() * styleHints.length)];
  const variationSeed = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  return composeAdminReply({
    intent: "lead_idle_restart",
    context: {
      reason: "idle_timeout",
      style_hint: styleHint,
      variation_seed: variationSeed,
    },
    hardFacts: {
      instruction: [
        "כתוב הודעה קצרה לליד אחרי שלא הייתה פעילות זמן מה.",
        "המסר חייב להיות: עבר זמן, ואם הוא רוצה אפשר להתחיל מחדש.",
        "עברית תקינה, נעימה ולא רובוטית.",
        "אל תמחזר פתיחה זהה בכל פעם. גוון את הניסוח.",
      ].join(" "),
    },
    tonePolicy: [
      "קצר, ברור ואנושי.",
      "לא טקסט תבניתי קשיח.",
    ],
    emergencyText: "עבר קצת זמן מאז ההודעה הקודמת. אם תרצה, אפשר להתחיל מחדש.",
    model: env.OPENAI_CHAT_MODEL,
    temperature: 0.7,
  });
}

async function startOnboardingFromInvite({ session, adminPhone, invite }) {
  const onboardingSeed = {
    invite_code: invite.code,
    skipped_question_keys: [],
    skip_selection_done: false,
  };
  const firstQuestion = await getNextOnboardingQuestionText(onboardingSeed);

  await updateAdminSessionState(session.id, {
    state: ADMIN_ONBOARDING,
    pending_action: "onboarding",
    collected_data: onboardingSeed,
    restaurant_id: "__onboarding__",
  });
  const welcome = [
    "*קוד ההזמנה אומת בהצלחה.*",
    "עכשיו נקים את העסק בצורה מקיפה כדי שהבוט יוכל לענות נכון ללקוחות כבר בפיילוט.",
    "נעבור שאלה-שאלה. כל שאלה חשובה, ואם משהו לא ברור אפשר לענות בקצרה ואני אשאל הבהרה.",
  ].join("\n");
  await markLeadConverted({ phone: adminPhone });
  await sendAdminTextMessageRaw(adminPhone, welcome);
  await sendAdminTextMessageRaw(adminPhone, firstQuestion);
  await pushAdminMessage(session.id, "assistant", `${welcome}\n${firstQuestion}`);
}

function onboardingFieldsListText(collectedData = {}) {
  const plan = getOnboardingQuestionPlan(collectedData);
  return plan.map((q, idx) => `${idx + 1}. ${onboardingQuestionLabel(q)}`).join("\n");
}

function onboardingProgressText(collectedData = {}) {
  const plan = getOnboardingQuestionPlan(collectedData);
  const answered = plan.filter((q) => String(collectedData[q.key] || "").trim()).length;
  return `התקדמות בהקמה: ${Math.min(answered + 1, plan.length)}/${plan.length}`;
}

function onboardingSelectableFieldsListText(collectedData = {}) {
  const plan = getOnboardingQuestionPlan(collectedData).filter((q) => q.key !== "venue_style");
  return plan
    .map((q, idx) => {
      return `${idx + 1}. ${onboardingQuestionLabel(q)} (חובה)`;
    })
    .join("\n");
}

function parseSkipIndexes(text, maxIndex) {
  const v = String(text || "").trim().toLowerCase();
  if (!v || ["אין", "לא", "לא רוצה לדלג", "בלי דילוג", "הכל", "all"].includes(v)) {
    return [];
  }
  const nums = (v.match(/\d+/g) || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= maxIndex);
  return [...new Set(nums)];
}

function nextIrrelevantAttemptData(collectedData = {}, fieldKey) {
  const attempts = { ...((collectedData && collectedData.irrelevant_attempts) || {}) };
  const nextCount = Number(attempts[fieldKey] || 0) + 1;
  attempts[fieldKey] = nextCount;
  return { attempts, nextCount };
}

function parseQuestionIndexes(text, maxIndex) {
  const tokens = String(text || "")
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
  const limit = Number(maxIndex || 0);
  const indexes = [...new Set(tokens.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= limit))];
  return indexes;
}

function normalizeEventReservationValue(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return "";
  if (["כן", "yes", "y", "true", "יש", "נדרש", "חובה"].includes(value)) return "כן";
  if (["לא", "no", "n", "false", "אין", "לא נדרש"].includes(value)) return "לא";
  return String(text || "").trim();
}

function normalizeLooseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/["'`״׳]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NO_VALUE_TOKENS = new Set([
  "",
  "none",
  "n/a",
  "-",
  "אין",
  "לא",
  "ללא",
  "בלי",
  "לא צוין",
  "לא רלוונטי",
  "לא ידוע",
  "לא יודע",
  "חסר",
]);

function normalizeNoValue(value, fallback = "אין") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const normalized = normalizeLooseText(raw);
  if (NO_VALUE_TOKENS.has(normalized)) {
    return fallback;
  }
  return raw;
}

function isUnknownPlaceholder(value) {
  const normalized = normalizeLooseText(value);
  return ["unknown", "לא ידוע", "לא יודע", "לא צוין", "-", "none", "n/a"].includes(normalized);
}

function sanitizeEventNameForAction(value) {
  const raw = String(value || "").trim();
  if (!raw || isUnknownPlaceholder(raw)) return "";
  const normalized = normalizeLooseText(raw).replace(/-/g, " ");
  const genericDescriptors = new Set([
    "חדפ",
    "חד פ",
    "חד פעמי",
    "חד פעמית",
    "אירוע חדפ",
    "אירוע חד פעמי",
    "אירוע חד פעמית",
    "אירוע חד פ",
    "אירוע",
    "אירוע מיוחד",
  ]);
  return genericDescriptors.has(normalized) ? "" : raw;
}

function normalizeEventTimeForAction(value) {
  const raw = String(value || "").trim();
  if (!raw || isUnknownPlaceholder(raw)) return "";
  const normalized = normalizeLooseText(raw);

  const hhmm = raw.match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
  if (hhmm) {
    return `${String(Number(hhmm[1])).padStart(2, "0")}:${hhmm[2]}`;
  }

  const hourOnly = raw.match(/^([01]?\d|2[0-3])$/);
  if (hourOnly) {
    return `${String(Number(hourOnly[1])).padStart(2, "0")}:00`;
  }

  const namedHours = {
    אחת: 1,
    אחד: 1,
    שתיים: 2,
    שתים: 2,
    שלוש: 3,
    ארבע: 4,
    חמש: 5,
    שש: 6,
    שבע: 7,
    שמונה: 8,
    תשע: 9,
    עשר: 10,
    עשרה: 10,
    "אחת עשרה": 11,
    "שתים עשרה": 12,
  };
  const wordHour = Object.keys(namedHours).find((word) => normalized.includes(word));
  const numInText = normalized.match(/(?:^|\s)(\d{1,2})(?:\s|$)/);
  let hour = wordHour ? namedHours[wordHour] : numInText ? Number(numInText[1]) : null;
  let minute = 0;
  if (normalized.includes("וחצי")) {
    minute = 30;
  } else if (normalized.includes("ורבע")) {
    minute = 15;
  }

  if (hour !== null && hour >= 0 && hour <= 23) {
    if (/(בערב|בלילה|אחהצ|אחר הצהריים)/.test(normalized) && hour >= 1 && hour <= 11) {
      hour += 12;
    }
    if (normalized.includes("בצהריים") && hour >= 1 && hour <= 10) {
      hour += 12;
    }
    if (normalized.includes("בבוקר") && hour === 12) {
      hour = 0;
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  return raw;
}

function formatDateDdMmYyyy(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}.${month}.${year}`;
}

function normalizeDaysText(value) {
  const raw = String(value || "").trim();
  if (!raw || isUnknownPlaceholder(raw)) return "";
  const normalized = normalizeLooseText(raw);
  const directReplacements = [
    { re: /\bא[׳'"]?\s*-\s*ה[׳'"]?\b/g, to: "ראשון-חמישי" },
    { re: /\bא[׳'"]?\s*-\s*ו[׳'"]?\b/g, to: "ראשון-שישי" },
    { re: /\bב[׳'"]?\s*-\s*ה[׳'"]?\b/g, to: "שני-חמישי" },
  ];
  let result = raw;
  for (const { re, to } of directReplacements) {
    result = result.replace(re, to);
  }

  const dayAliases = [
    { re: /\bיום\s*א(?:׳|')?|\bא(?:׳|')\b/g, to: "ראשון" },
    { re: /\bיום\s*ב(?:׳|')?|\bב(?:׳|')\b/g, to: "שני" },
    { re: /\bיום\s*ג(?:׳|')?|\bג(?:׳|')\b/g, to: "שלישי" },
    { re: /\bיום\s*ד(?:׳|')?|\bד(?:׳|')\b/g, to: "רביעי" },
    { re: /\bיום\s*ה(?:׳|')?|\bה(?:׳|')\b/g, to: "חמישי" },
    { re: /\bיום\s*ו(?:׳|')?|\bו(?:׳|')\b/g, to: "שישי" },
    { re: /\bשבת\b/g, to: "שבת" },
  ];
  for (const { re, to } of dayAliases) {
    result = result.replace(re, to);
  }
  if (normalized.includes("ימי חול") || normalized.includes("יום חול")) {
    result = "ראשון-חמישי";
  }
  return String(result || "").replace(/\s+/g, " ").trim();
}

function normalizeHoursRangeText(value) {
  const raw = String(value || "").trim();
  if (!raw || isUnknownPlaceholder(raw)) return "";
  let result = raw
    .replace(/(\d{1,2})\.(\d{2})/g, "$1:$2")
    .replace(/(\d{1,2})\s*עד\s*(\d{1,2})(?!:)/g, (_, a, b) => `${a}:00-${b}:00`)
    .replace(/(\d{1,2}):(\d{2})\s*עד\s*(\d{1,2}):(\d{2})/g, "$1:$2-$3:$4");

  result = result.replace(/(\b\d{1,2}\b)(?!:)/g, (m) => {
    const n = Number(m);
    if (Number.isNaN(n) || n < 0 || n > 23) return m;
    return `${String(n).padStart(2, "0")}:00`;
  });

  result = result.replace(/(\b\d{1,2}):(\d{2})/g, (_, h, m) => `${String(Number(h)).padStart(2, "0")}:${m}`);
  return result;
}

function normalizeTicketPriceForAction(value) {
  const raw = String(value || "").trim();
  if (!raw || isUnknownPlaceholder(raw)) return "";
  const normalized = normalizeLooseText(raw);
  if (/(חינם|ללא עלות|בלי עלות|ללא תשלום)/.test(normalized)) {
    return "חינם";
  }
  const amountMatch = normalized.match(/(\d{1,5})/);
  if (amountMatch) {
    return `${Number(amountMatch[1])} ש"ח`;
  }
  return normalizeNoValue(raw, raw);
}

function normalizeKosherTypeForAction(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = normalizeLooseText(raw);
  if (/(אין כשרות|לא כשר|ללא כשרות)/.test(normalized)) return "אין כשרות";
  if (/(מהדרין|בדצ|בד״צ|בדץ)/.test(normalized)) return "כשר למהדרין";
  if (/(רבנות|כשר)/.test(normalized)) return "כשר";
  return raw;
}

function normalizeTargetTextForAction(value) {
  const raw = String(value || "").trim();
  if (!raw || isUnknownPlaceholder(raw)) return "";
  return raw
    .replace(/^(תמחק|מחק|תוריד|הסר|למחוק|למחיקה|בבקשה למחוק)\s+/i, "")
    .replace(/^(את\s+)?(הפריט|האירוע|המבצע)\s+/i, "")
    .trim();
}

function parseRelativeHebrewDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = normalizeLooseText(raw).replace(/-/g, " ");
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (normalized.includes("היום")) return base;
  if (normalized.includes("מחרתיים")) return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 2);
  if (normalized.includes("מחר")) return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1);

  const dayMap = {
    ראשון: 0,
    שני: 1,
    שלישי: 2,
    רביעי: 3,
    חמישי: 4,
    שישי: 5,
    שבת: 6,
  };
  const dayMatch = normalized.match(/(?:יום\s*)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/);
  if (dayMatch && dayMap[dayMatch[1]] !== undefined) {
    const targetDay = dayMap[dayMatch[1]];
    const currentDay = base.getDay();
    let delta = (targetDay - currentDay + 7) % 7;
    if (delta === 0) delta = 7;
    if (normalized.includes("שבוע הבא")) {
      delta += 7;
    }
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
  }

  if (normalized.includes("שבוע הבא") || normalized.includes("עוד שבוע")) {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 7);
  }

  return null;
}

function normalizeEventDateForAction(value) {
  const raw = String(value || "").trim();
  if (!raw || isUnknownPlaceholder(raw)) return "";
  const ddmmyyyy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    const year = Number(ddmmyyyy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
    }
  }
  const yyyymmdd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyymmdd) {
    const year = Number(yyyymmdd[1]);
    const month = Number(yyyymmdd[2]);
    const day = Number(yyyymmdd[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
    }
  }
  const parsedRelative = parseRelativeHebrewDate(raw);
  if (parsedRelative) {
    return formatDateDdMmYyyy(parsedRelative);
  }
  return raw;
}

function normalizeAdminParsedFields(action, fields = {}) {
  const normalized = { ...(fields || {}) };
  if (action === "add_event") {
    if ("event_name" in normalized) {
      normalized.event_name = sanitizeEventNameForAction(normalized.event_name);
    }
    if ("date" in normalized) {
      normalized.date = normalizeEventDateForAction(normalized.date);
    }
    if ("time" in normalized) {
      normalized.time = normalizeEventTimeForAction(normalized.time);
    }
    if ("ticket_price" in normalized) {
      normalized.ticket_price = normalizeTicketPriceForAction(normalized.ticket_price);
    }
    if ("reservation_required" in normalized) {
      normalized.reservation_required = normalizeEventReservationValue(normalized.reservation_required);
    }
    if ("details" in normalized) {
      normalized.details = normalizeNoValue(normalized.details, "אין");
    }
  }
  if (action === "add_promotion" && "end_date" in normalized) {
    normalized.end_date = normalizeEventDateForAction(normalized.end_date);
  }
  if (action === "update_hours") {
    if ("days" in normalized) {
      normalized.days = normalizeDaysText(normalized.days);
    }
    if ("hours_text" in normalized) {
      normalized.hours_text = normalizeHoursRangeText(normalized.hours_text);
    }
  }
  if (action === "update_kosher" && "kosher_type" in normalized) {
    normalized.kosher_type = normalizeKosherTypeForAction(normalized.kosher_type);
  }
  if (action === "delete_item" && "target_text" in normalized) {
    normalized.target_text = normalizeTargetTextForAction(normalized.target_text);
  }
  if (action === "update_custom" && "target_text" in normalized) {
    normalized.target_text = normalizeTargetTextForAction(normalized.target_text);
  }
  return normalized;
}

function isEventEditIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  return ["ערוך", "עריכה", "לערוך", "שנה", "לתקן", "edit", "update", "modify"].includes(value);
}

function eventEditFields() {
  return [
    { key: "event_name", label: "שם האירוע" },
    { key: "date", label: "תאריך" },
    { key: "time", label: "שעה" },
    { key: "ticket_price", label: "מחיר" },
    { key: "reservation_required", label: "האם צריך הזמנה מראש" },
    { key: "details", label: "פרטים נוספים" },
  ];
}

function eventEditListText(data = {}) {
  const val = (key, fallback = "לא צוין") => {
    const value = String(data[key] || "").trim();
    return value || fallback;
  };
  return [
    "איזה שדה תרצה לערוך? כתוב מספר:",
    `1. שם האירוע: ${val("event_name", "-")}`,
    `2. תאריך: ${val("date", "-")}`,
    `3. שעה: ${val("time", "-")}`,
    `4. מחיר: ${val("ticket_price")}`,
    `5. הזמנה מראש: ${val("reservation_required")}`,
    `6. פרטים נוספים: ${val("details", "אין")}`,
  ].join("\n");
}

function parseEventEditField(text) {
  const value = String(text || "").trim().toLowerCase();
  const mapByNumber = {
    1: "event_name",
    2: "date",
    3: "time",
    4: "ticket_price",
    5: "reservation_required",
    6: "details",
  };
  const num = Number(value);
  if (Number.isInteger(num) && mapByNumber[num]) {
    return mapByNumber[num];
  }
  const byKeyword = [
    { key: "event_name", words: ["שם", "אירוע", "event name"] },
    { key: "date", words: ["תאריך", "date"] },
    { key: "time", words: ["שעה", "time"] },
    { key: "ticket_price", words: ["מחיר", "price", "עלות"] },
    { key: "reservation_required", words: ["הזמנה", "reservation", "מראש"] },
    { key: "details", words: ["פרטים", "details", "מידע נוסף"] },
  ];
  const hit = byKeyword.find((item) => item.words.some((w) => value.includes(w)));
  return hit ? hit.key : null;
}

function eventFieldAskText(fieldKey) {
  const labels = {
    event_name: "מה שם האירוע המעודכן?",
    date: "מה התאריך המעודכן של האירוע?",
    time: "מה השעה המעודכנת?",
    ticket_price: "מה המחיר המעודכן? אם אין מחיר, כתוב 'אין'.",
    reservation_required: "האם נדרשת הזמנה מראש? כתוב כן/לא.",
    details: "אילו פרטים נוספים תרצה להוסיף? אם אין, כתוב 'אין'.",
  };
  return labels[fieldKey] || "כתוב את הערך המעודכן.";
}

function buildConfirmSummaryText(action, data) {
  const base = buildAdminSummary(action, data);
  if (action === "add_event") {
    return `${base}\n\nלאשר ולשמור? (כן/לא)\nאם תרצה לערוך שדה ספציפי, כתוב 'ערוך'.`;
  }
  return `${base}\n\nלאשר ולשמור? (כן/לא)`;
}

function parseExpiryDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const ddmmyyyy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    const year = Number(ddmmyyyy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(year, month - 1, day, 23, 59, 59, 999);
    }
  }

  const yyyymmdd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyymmdd) {
    const year = Number(yyyymmdd[1]);
    const month = Number(yyyymmdd[2]);
    const day = Number(yyyymmdd[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return new Date(year, month - 1, day, 23, 59, 59, 999);
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const hasExplicitTime = /[tT ]\d{1,2}:\d{2}/.test(raw);
  if (hasExplicitTime) {
    return parsed;
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59, 999);
}

function buildKnowledgeListPage(docs, offset = 0, pageSize = KNOWLEDGE_LIST_PAGE_SIZE) {
  const safeDocs = Array.isArray(docs) ? docs : [];
  const total = safeDocs.length;
  if (total === 0) {
    return {
      text: "אין כרגע פריטים בבסיס הידע.",
      nextOffset: 0,
      hasMore: false,
      total,
    };
  }

  const start = Math.max(0, Math.min(Number(offset || 0), total));
  const size = Math.max(1, Number(pageSize || KNOWLEDGE_LIST_PAGE_SIZE));
  const pageDocs = safeDocs.slice(start, start + size);
  const rows = pageDocs.map((doc, idx) => {
    const data = typeof doc.data === "function" ? doc.data() : doc;
    return formatKnowledgeItemForManager(data, start + idx, total);
  });
  const nextOffset = start + pageDocs.length;
  const hasMore = nextOffset < total;
  const header = `*אלה הפרטים ששמורים כרגע (${start + 1}-${nextOffset} מתוך ${total}):*`;
  const footer = hasMore
    ? `יש עוד ${total - nextOffset} פריטים. כתוב *המשך* או *עוד* כדי לראות את ההמשך.`
    : "זה כל המידע ששמור כרגע.";

  return {
    text: [
      header,
      "",
      rows.join("\n\n"),
      "",
      footer,
    ].join("\n"),
    nextOffset,
    hasMore,
    total,
  };
}

async function listKnowledgeItemsPage(restaurantId, offset = 0, pageSize = KNOWLEDGE_LIST_PAGE_SIZE) {
  const snap = await db.collection(`restaurants/${restaurantId}/Knowledge_Base`).get();
  if (snap.empty) {
    return buildKnowledgeListPage([], 0, pageSize);
  }
  return buildKnowledgeListPage(snap.docs, offset, pageSize);
}

async function listKnowledgeItems(restaurantId) {
  const page = await listKnowledgeItemsPage(restaurantId, 0);
  return page.text;
}

async function getKnowledgeContentForManager(restaurantId, query, session) {
  const q = String(query || "").trim();
  const lastContent = session?.last_added_knowledge_content;
  const lastAt = Number(session?.last_added_at || 0);
  const isRecent = lastAt > 0 && Date.now() - lastAt <= LAST_ADDED_KNOWLEDGE_TTL_MS;

  if (isLastAddedIntent(q) && isRecent && lastContent) {
    return `*זה מה שנשמר לאחרונה במערכת:*\n\n*נושא/תוכן שמור:*\n${lastContent}`;
  }

  const searchQuery = q || "כללי";
  const { items } = await retrieveKnowledgeContext(restaurantId, searchQuery, { topK: 5, minScore: 0.22 });
  if (!items || items.length === 0) {
    return "לא מצאתי במאגר תוכן שמתאים לזה.";
  }
  const normalizedQuery = normalizeLooseText(searchQuery);
  const wantsMultipleItems = /(הכל|כל הפרטים|כל הסעיפים|כמה סעיפים|עוד פרטים|עוד סעיפים)/.test(normalizedQuery);
  const kosherQuery = /(כשר|כשרות|רבנות|בדצ|בדץ|מהדרין)/.test(normalizedQuery);
  const receiptQuery = /(קבלה|חשבונית|משוב|תלונה)/.test(normalizedQuery);

  let finalItems = items;
  if (kosherQuery) {
    const kosherItems = items.filter((item) => {
      const category = String(item.category || "").trim().toLowerCase();
      const content = normalizeLooseText(item.content);
      return category === "kosher" || /(כשר|כשרות|רבנות|בדצ|בדץ|מהדרין)/.test(content);
    });
    if (kosherItems.length > 0) {
      finalItems = kosherItems;
    }
  } else if (receiptQuery) {
    const receiptItems = items.filter((item) => /(קבלה|חשבונית|משוב|תלונה)/.test(normalizeLooseText(item.content)));
    if (receiptItems.length > 0) {
      finalItems = receiptItems;
    }
  }

  finalItems = wantsMultipleItems ? finalItems.slice(0, 3) : finalItems.slice(0, 1);
  const parts = finalItems.map((item, idx) => formatKnowledgeItemForManager(item, idx, finalItems.length));
  const header = finalItems.length > 1
    ? `*מצאתי ${finalItems.length} פריטים בנושא "${searchQuery}":*`
    : `*זה מה ששמור כרגע בנושא "${searchQuery}":*`;
  return [
    header,
    "",
    parts.join("\n\n---\n\n"),
    "",
    "*אם תרצה, אפשר גם לעדכן את הניסוח או לערוך את הנושא הזה.*",
  ].join("\n");
}

function pickBestDeleteMatch(docs, targetText) {
  const target = normalizeLooseText(targetText);
  if (!target) return null;
  const targetTokens = target.split(/\s+/).filter((t) => t.length >= 2);
  let best = null;

  for (const doc of docs) {
    const content = normalizeLooseText(String(doc.data().content || ""));
    let score = 0;
    if (content.includes(target)) {
      score += 5;
    }
    for (const token of targetTokens) {
      if (content.includes(token)) {
        score += 1;
      }
    }
    if (!best || score > best.score) {
      best = { doc, score };
    }
  }
  return best && best.score > 0 ? best.doc : null;
}

async function saveKnowledgeAction(restaurantId, action, fields) {
  const safeFields = normalizeAdminParsedFields(action, fields || {});
  if (action === "view_knowledge") {
    return listKnowledgeItems(restaurantId);
  }

  if (action === "delete_item") {
    const snap = await db.collection(`restaurants/${restaurantId}/Knowledge_Base`).get();
    const targetText = normalizeTargetTextForAction(safeFields.target_text || "");
    const matched = pickBestDeleteMatch(snap.docs, targetText);
    if (!matched) {
      return "לא מצאתי פריט מתאים למחיקה.";
    }
    await matched.ref.delete();
    invalidateCache(restaurantId);
    return "בוצעה מחיקה של הפריט המבוקש.";
  }

  const content = buildKnowledgeContent(action, safeFields);
  const category = categoryForAction(action);
  const knowledgeEntry = await buildKnowledgeEntry({
    category,
    content,
    intentNote: safeFields.knowledge_intent_note || "",
  });
  const embedding = await createEmbedding(knowledgeEntry.embeddingText);
  const payload = {
    category,
    content: knowledgeEntry.content,
    embedding,
    ...(knowledgeEntry.metadata || {}),
    intent_note: safeFields.knowledge_intent_note || null,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (action === "add_event" && safeFields.date) {
    const expiryDate = parseExpiryDate(safeFields.date);
    if (expiryDate) {
      payload.expires_at = admin.firestore.Timestamp.fromDate(expiryDate);
    } else {
      logger.warn("Could not parse event expiry date, skipping expires_at", {
        restaurantId,
        date: safeFields.date,
      });
    }
  }
  if (action === "add_promotion" && safeFields.end_date) {
    const expiryDate = parseExpiryDate(safeFields.end_date);
    if (expiryDate) {
      payload.expires_at = admin.firestore.Timestamp.fromDate(expiryDate);
    } else {
      logger.warn("Could not parse promotion expiry date, skipping expires_at", {
        restaurantId,
        endDate: safeFields.end_date,
      });
    }
  }

  if (action === "update_hours" || action === "update_kosher") {
    const existing = await db
      .collection(`restaurants/${restaurantId}/Knowledge_Base`)
      .where("category", "==", category)
      .limit(1)
      .get();
    if (!existing.empty) {
      await existing.docs[0].ref.set(payload, { merge: true });
      invalidateCache(restaurantId);
      return { message: "בוצע עדכון בהצלחה.", savedContent: payload.content };
    }
  }

  if (action === "update_custom") {
    const snap = await db.collection(`restaurants/${restaurantId}/Knowledge_Base`).get();
    const targetText = normalizeTargetTextForAction(safeFields.target_text || "");
    const matched = pickBestDeleteMatch(snap.docs, targetText);
    if (!matched) {
      await db.collection(`restaurants/${restaurantId}/Knowledge_Base`).add(payload);
      invalidateCache(restaurantId);
      return {
        message: "לא מצאתי פריט קיים מתאים, אז שמרתי את זה כמידע חדש בבסיס הידע.",
        savedContent: payload.content,
      };
    }
    await matched.ref.set(payload, { merge: true });
    invalidateCache(restaurantId);
    return { message: "המידע הקיים עודכן בהצלחה.", savedContent: payload.content };
  }

  await db.collection(`restaurants/${restaurantId}/Knowledge_Base`).add(payload);
  invalidateCache(restaurantId);
  return { message: "נשמר בהצלחה בבסיס הידע.", savedContent: payload.content };
}

async function processAdminMessage({ adminPhone, text }) {
  const restaurantByPhone = await findRestaurantByAdminPhone(adminPhone);
  const sessionRestaurantId = restaurantByPhone ? restaurantByPhone.restaurant_id || restaurantByPhone.id : "__onboarding__";
  const session = await getOrCreateAdminSession(adminPhone, sessionRestaurantId);
  const trimmedText = sanitizeAdminText(text);
  const loginCommand = parseLoginCommand(trimmedText);
  const loginStartRequested = isLoginStartIntent(trimmedText);
  const loginRelatedMessage = Boolean(loginCommand || loginStartRequested || isLoginState(session.state));

  if (!trimmedText) {
    await sendAdminTextMessage(adminPhone, "לא קיבלתי טקסט לקריאה. נסה לשלוח הודעה כתובה.");
    return;
  }
  if (isPrivateResetCode(trimmedText)) {
    await startLeadSalesIntro({ session, adminPhone, resetConversation: true });
    return;
  }
  if (trimmedText.length > ADMIN_MAX_MESSAGE_CHARS) {
    await sendAdminTextMessage(
      adminPhone,
      `ההודעה ארוכה מדי. שלח עד ${ADMIN_MAX_MESSAGE_CHARS} תווים בכל הודעה.`
    );
    return;
  }

  const { isLocked, lockedUntil } = lockInfo(session.collected_data || {});
  if (isLocked) {
    const minutesLeft = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
    await sendAdminTextMessage(adminPhone, `בוצעו יותר מדי ניסיונות שגויים. נסה שוב בעוד כ-${minutesLeft} דקות.`);
    return;
  }

  const nextAttemptAt = Number(session.collected_data?.next_login_attempt_at || 0);
  if (loginRelatedMessage && nextAttemptAt > Date.now()) {
    const waitSeconds = Math.max(1, Math.ceil((nextAttemptAt - Date.now()) / 1000));
    await sendAdminTextMessage(adminPhone, `רגע קטן לפני ניסיון נוסף. נסה שוב בעוד כ-${waitSeconds} שניות.`);
    return;
  }

  // Idle timeout only for users linked to a restaurant (managers). Leads stay in the conversation.
  // If we're already waiting for manager code, don't re-trigger idle timeout on every message.
  const awaitingManagerCode = Boolean(session.collected_data?.awaiting_manager_code);
  if (isSessionIdleExpired(session) && restaurantByPhone && !awaitingManagerCode) {
    const hasRestaurantByPhone = Boolean(restaurantByPhone);
    const hasManagerCode = hasRestaurantByPhone
      && Boolean(restaurantByPhone.manager_code_hash)
      && Boolean(restaurantByPhone.manager_code_salt);
    const noManagerCode = hasRestaurantByPhone && !hasManagerCode;

    if (noManagerCode) {
      const restId = restaurantByPhone.restaurant_id || restaurantByPhone.id;
      await updateAdminSessionState(session.id, {
        state: ADMIN_IDLE,
        pending_action: null,
        restaurant_id: restId,
        collected_data: {
          ...(session.collected_data || {}),
          authenticated_restaurant_id: restId,
          auth_at: Date.now(),
          awaiting_manager_code: false,
          login_restaurant_id: null,
          edit_queue: [],
          edit_queue_pos: 0,
        },
      });
      session.state = ADMIN_IDLE;
      session.pending_action = null;
      session.restaurant_id = restId;
      session.collected_data = {
        ...(session.collected_data || {}),
        authenticated_restaurant_id: restId,
        auth_at: Date.now(),
        awaiting_manager_code: false,
        login_restaurant_id: null,
        edit_queue: [],
        edit_queue_pos: 0,
      };
      // לא מחזירים – ממשיכים לטפל בהודעה כרגיל (ברכה וכו')
    } else {
      await updateAdminSessionState(session.id, {
        state: ADMIN_IDLE,
        pending_action: null,
        collected_data: {
          ...(session.collected_data || {}),
          authenticated_restaurant_id: null,
          auth_at: null,
          awaiting_manager_code: true,
          login_restaurant_id: restaurantByPhone.restaurant_id || restaurantByPhone.id,
          edit_queue: [],
          edit_queue_pos: 0,
        },
      });
      session.state = ADMIN_IDLE;
      session.pending_action = null;
      session.collected_data = {
        ...(session.collected_data || {}),
        authenticated_restaurant_id: null,
        auth_at: null,
        awaiting_manager_code: true,
        login_restaurant_id: restaurantByPhone.restaurant_id || restaurantByPhone.id,
        edit_queue: [],
        edit_queue_pos: 0,
      };
      if (hasManagerCode) {
        await sendAdminTextMessage(adminPhone, pickIdleManagerCodeMessage());
        return;
      }
      if (!hasRestaurantByPhone) {
        const leadIdleReply = await composeLeadIdleRestartMessage();
        const replyText = String(leadIdleReply || "").trim();
        await sendAdminTextMessageRaw(adminPhone, replyText);
        await pushAdminMessage(session.id, "user", text);
        await pushAdminMessage(session.id, "assistant", replyText);
        return;
      }
    }
  }

  await pushAdminMessage(session.id, "user", text);

  if (isForgotCodeIntent(trimmedText) || session.state === ADMIN_FORGOT_CODE_VERIFY) {
    if (isCancelText(trimmedText)) {
      await resetAdminSession(session.id);
      await sendAdminTextMessage(adminPhone, "שחזור הקוד בוטל.");
      return;
    }

    if (session.state !== ADMIN_FORGOT_CODE_VERIFY) {
      await updateAdminSessionState(session.id, {
        state: ADMIN_FORGOT_CODE_VERIFY,
        pending_action: "forgot_manager_code",
        collected_data: {
          ...(session.collected_data || {}),
          forgot_stage: "ask_restaurant_id",
          forgot_attempts: 0,
          forgot_restaurant_id: "",
        },
      });
      await sendAdminTextMessage(
        adminPhone,
        "נתחיל שחזור קוד מנהל.\nכתוב את מזהה העסק שלך (restaurant_id)."
      );
      return;
    }

    const stage = session.collected_data?.forgot_stage || "ask_restaurant_id";
    const attempts = Number(session.collected_data?.forgot_attempts || 0);

    if (stage === "ask_restaurant_id") {
      const candidateRestaurantId = trimmedText;
      const restaurantById = await findRestaurantById(candidateRestaurantId);
      if (!restaurantById) {
        const nextAttempts = attempts + 1;
        await updateAdminSessionState(session.id, {
          state: ADMIN_FORGOT_CODE_VERIFY,
          pending_action: "forgot_manager_code",
          collected_data: {
            ...(session.collected_data || {}),
            forgot_stage: "ask_restaurant_id",
            forgot_attempts: nextAttempts,
            forgot_restaurant_id: candidateRestaurantId,
          },
        });
        if (nextAttempts >= 2) {
          await escalateForgotCodeToHuman({
            adminPhone,
            restaurantId: candidateRestaurantId,
            reason: "מזהה עסק לא נמצא פעמיים",
          });
          await resetAdminSession(session.id);
          await sendAdminTextMessage(adminPhone, "לא הצלחתי לאמת את הפרטים. פתחתי עבורך פנייה לטיפול ידני.");
          return;
        }
        await sendAdminTextMessage(adminPhone, "מזהה העסק לא נמצא. נסה שוב או כתוב 'בטל'.");
        return;
      }

      await updateAdminSessionState(session.id, {
        state: ADMIN_FORGOT_CODE_VERIFY,
        pending_action: "forgot_manager_code",
        collected_data: {
          ...(session.collected_data || {}),
          forgot_stage: "ask_business_phone",
          forgot_attempts: 0,
          forgot_restaurant_id: restaurantById.restaurant_id || restaurantById.id,
        },
      });
      await sendAdminTextMessage(
        adminPhone,
        "מעולה. עכשיו כתוב את מספר הטלפון של העסק או טלפון המנהל כפי שהוגדרו בהקמה."
      );
      return;
    }

    if (stage === "ask_business_phone") {
      const restaurantIdForReset = session.collected_data?.forgot_restaurant_id;
      const restaurantById = await findRestaurantById(restaurantIdForReset);
      if (!restaurantById) {
        await escalateForgotCodeToHuman({
          adminPhone,
          restaurantId: restaurantIdForReset,
          reason: "המסעדה לא נמצאה בשלב אימות טלפון",
        });
        await resetAdminSession(session.id);
        await sendAdminTextMessage(adminPhone, "לא הצלחתי לאמת את הפרטים. פתחתי עבורך פנייה לטיפול ידני.");
        return;
      }

      const providedPhone = normalizePhone(trimmedText);
      const businessPhone = normalizePhone(restaurantById.phone_number || "");
      const managerPhone = normalizePhone(restaurantById.admin_phone || "");
      const phoneMatches = providedPhone && (providedPhone === businessPhone || providedPhone === managerPhone);

      if (!phoneMatches) {
        const nextAttempts = attempts + 1;
        await updateAdminSessionState(session.id, {
          state: ADMIN_FORGOT_CODE_VERIFY,
          pending_action: "forgot_manager_code",
          collected_data: {
            ...(session.collected_data || {}),
            forgot_stage: "ask_business_phone",
            forgot_attempts: nextAttempts,
          },
        });
        if (nextAttempts >= 2) {
          await escalateForgotCodeToHuman({
            adminPhone,
            restaurantId: restaurantIdForReset,
            reason: "אימות טלפון נכשל פעמיים",
          });
          await resetAdminSession(session.id);
          await sendAdminTextMessage(adminPhone, "לא הצלחתי לאמת את הפרטים. פתחתי עבורך פנייה לטיפול ידני.");
          return;
        }
        await sendAdminTextMessage(adminPhone, "הטלפון לא תואם לרשומות שלנו. נסה שוב או כתוב 'בטל'.");
        return;
      }

      await updateAdminSessionState(session.id, {
        state: ADMIN_FORGOT_CODE_VERIFY,
        pending_action: "forgot_manager_code",
        collected_data: {
          ...(session.collected_data || {}),
          forgot_stage: "set_new_manager_code",
          forgot_attempts: 0,
        },
      });
      await sendAdminTextMessage(
        adminPhone,
        "האימות הצליח. כתוב עכשיו קוד מנהל חדש (8+ תווים, אות גדולה/קטנה, מספר וסימן מיוחד)."
      );
      return;
    }

    if (stage === "set_new_manager_code") {
      const validation = validateManagerCode(trimmedText);
      if (!validation.valid) {
        await sendAdminTextMessageRaw(adminPhone, validation.message);
        return;
      }

      const restaurantIdForReset = session.collected_data?.forgot_restaurant_id;
      const restaurantById = await findRestaurantById(restaurantIdForReset);
      if (!restaurantById) {
        await escalateForgotCodeToHuman({
          adminPhone,
          restaurantId: restaurantIdForReset,
          reason: "המסעדה לא נמצאה בשלב עדכון קוד",
        });
        await resetAdminSession(session.id);
        await sendAdminTextMessage(adminPhone, "אירעה שגיאה בשחזור הקוד. פתחתי עבורך פנייה לטיפול ידני.");
        return;
      }

      const { hash, salt } = hashManagerCode(trimmedText);
      await db.collection("restaurants").doc(restaurantById.id).set(
        {
          manager_code_hash: hash,
          manager_code_salt: salt,
          manager_auth_enabled: true,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await resetAdminSession(session.id);
      await sendAdminTextMessage(adminPhone, "קוד המנהל עודכן בהצלחה. אפשר להתחבר מחדש עם הקוד החדש.");
      return;
    }
  }

  if (!restaurantByPhone) {
    if (isCancelText(trimmedText)) {
      await resetAdminSession(session.id);
      if (isLoginState(session.state)) {
        await sendAdminTextMessage(adminPhone, "תהליך ההתחברות בוטל. כשתרצה להתחבר מחדש, כתוב 'כניסה'.");
      } else {
        await sendAdminTextMessage(adminPhone, "התהליך בוטל. אפשר לשלוח קוד הזמנה חדש כדי להתחיל שוב.");
      }
      return;
    }

    if (session.state === ADMIN_AWAITING_NUMBER_CONNECT) {
      const inviteCode = String(session.collected_data?.invite_code || "").trim();
      if (!inviteCode) {
        await resetAdminSession(session.id);
        await sendAdminTextMessage(adminPhone, "לא מצאתי קוד הזמנה פעיל. שלח קוד הזמנה כדי להתחיל מחדש.");
        return;
      }

      if (!isConnectDoneIntent(trimmedText)) {
        const reminder = [
          "כדי להמשיך צריך קודם לחבר את מספר העסק ל-360dialog.",
          DIALOG_EMBEDDED_SIGNUP_URL
            ? `קישור לחיבור: ${DIALOG_EMBEDDED_SIGNUP_URL}`
            : "לא הוגדר קישור חיבור במערכת. כתוב 'מוכן' אחרי שהחיבור בוצע.",
          "אחרי שסיימת כתוב: מוכן",
        ].join("\n");
        await sendAdminTextMessageRaw(adminPhone, reminder);
        return;
      }

      const pendingConnection = await consumePendingConnectionByAdminPhone(adminPhone);
      const connectedPhoneNumberId = String(pendingConnection?.phone_number_id || "").trim();
      if (!connectedPhoneNumberId) {
        await sendAdminTextMessageRaw(
          adminPhone,
          "עדיין לא זוהה חיבור מספר מהמערכת החיצונית. השלם את החיבור ואז כתוב שוב 'מוכן'."
        );
        return;
      }

      const merged = {
        ...(session.collected_data || {}),
        whatsapp_phone_number_id: connectedPhoneNumberId,
      };
      const firstQuestion = await getNextOnboardingQuestionText(merged);
      const nextState = firstQuestion ? ADMIN_ONBOARDING : ADMIN_ONBOARDING_CONFIRM;
      await updateAdminSessionState(session.id, {
        state: nextState,
        pending_action: "onboarding",
        collected_data: merged,
        restaurant_id: "__onboarding__",
      });
      if (firstQuestion) {
        await sendAdminTextMessage(adminPhone, "מעולה, החיבור הצליח. נתחיל עכשיו את ההקמה.");
        await sendAdminTextMessageRaw(adminPhone, firstQuestion);
        await pushAdminMessage(session.id, "assistant", `מעולה, החיבור הצליח. נתחיל עכשיו את ההקמה.\n${firstQuestion}`);
      } else {
        const summary = buildOnboardingSummary(merged);
        await sendAdminTextMessage(adminPhone, "מעולה, החיבור הצליח. אפשר להמשיך לאישור הסופי.");
        await sendAdminTextMessageRaw(adminPhone, summary);
        await pushAdminMessage(session.id, "assistant", summary);
      }
      return;
    }

    if ((session.state === ADMIN_LEAD_SALES || session.state === ADMIN_LEAD_DEMO) && !isPotentialInviteCode(trimmedText)) {
      const embeddedInviteCode = extractInviteCodeCandidate(trimmedText);
      if (embeddedInviteCode) {
        const embeddedInvite = await getPendingInviteCode(embeddedInviteCode);
        if (embeddedInvite) {
          await startOnboardingFromInvite({ session, adminPhone, invite: embeddedInvite });
          return;
        }
      }
      if (isInviteCodeHelpIntent(trimmedText)) {
        await sendAdminTextMessageRaw(
          adminPhone,
          "מעולה. כדי להתחיל את ההקמה פשוט שלח/י כאן את קוד ההזמנה עצמו (רק הקוד, בלי טקסט נוסף)."
        );
        return;
      }

      const stage = leadStage(session);
      await upsertLead({ phone: adminPhone, stage: stage || "sales_active" });

      if (stage === "awaiting_interest") {
        if (isAffirmativeLeadIntent(trimmedText)) {
          const welcome = await composeLeadSalesReply({
            session,
            text: trimmedText,
            mode: "sales",
            flowInstruction: [
              "הלקוח הביע עניין לשמוע על הפתרון.",
              "ענה בצורה אנושית, שנונה וקצרה.",
              "שאל אם להתחיל בשיחה קצרה על הערך העסקי או לקפוץ ישר להדגמה חיה.",
              "אל תציע הדגמה חוזרת אם כבר הייתה אחת, אלא אם הלקוח ביקש במפורש.",
            ].join("\n"),
          });
          await updateAdminSessionState(session.id, {
            state: ADMIN_LEAD_SALES,
            pending_action: "lead_sales",
            collected_data: {
              ...(session.collected_data || {}),
              lead_stage: "chatting",
            },
          });
          await sendAdminTextMessageRaw(adminPhone, welcome);
          await pushAdminMessage(session.id, "assistant", welcome);
          return;
        }
        if (isNegativeLeadIntent(trimmedText)) {
          await resetAdminSession(session.id);
          const politeClose = await composeLeadSalesReply({
            session,
            text: trimmedText,
            mode: "sales",
            flowInstruction: [
              "הלקוח כרגע לא מעוניין.",
              "ענה באמפתיה ובקצרה, בלי לחץ.",
              "השאר דלת פתוחה לפנייה עתידית.",
            ].join("\n"),
          });
          await sendAdminTextMessageRaw(adminPhone, politeClose);
          return;
        }
      }

      if (stage === "awaiting_demo_type") {
        const rawType = sanitizeAdminText(trimmedText).slice(0, 60);
        const demoBusinessType = normalizeDemoBusinessType(rawType);
        const handoffMessage = await composeLeadSalesReply({
          session,
          text: trimmedText,
          mode: "sales",
          flowInstruction: [
            "הלקוח נתן סוג עסק ואנחנו עומדים להתחיל הדגמה חיה.",
            `כתוב הודעת מעבר טבעית וקצרה בעברית תקינה עבור ${businessTypeWithArticle(demoBusinessType)}.`,
            "הסבר שהחל מההודעה הבאה זו הדמיה של בוט שירות לקוחות אמיתי של המקום.",
            "הוסף משפט קצר: אם ירצה לצאת מהדגמה ולחזור לשיחת מכירה, שיכתוב בצורה חופשית שהוא רוצה לצאת מהדגמה.",
            "אל תשתמש בנוסח קבוע קשיח.",
          ].join("\n"),
        });
        await updateAdminSessionState(session.id, {
          state: ADMIN_LEAD_DEMO,
          pending_action: "lead_sales",
          collected_data: {
            ...(session.collected_data || {}),
            demo_business_type: demoBusinessType,
            lead_stage: "demo_live",
            demo_reply_count: 0,
          },
        });
        await sendAdminTextMessageRaw(adminPhone, handoffMessage);
        await pushAdminMessage(session.id, "assistant", handoffMessage);
        return;
      }

      const explicitDemoIntent = isDemoIntent(trimmedText);
      let contextualDemoIntent = false;
      const allowContextDemoDetection = session.state !== ADMIN_LEAD_DEMO
        && stage !== "awaiting_demo_type"
        && ["awaiting_interest", "chatting"].includes(stage || "");
      if (!explicitDemoIntent && allowContextDemoDetection) {
        contextualDemoIntent = await inferDemoIntentFromContext({ session, text: trimmedText });
      }
      if ((explicitDemoIntent || contextualDemoIntent) && stage !== "awaiting_demo_type" && session.state !== ADMIN_LEAD_DEMO) {
        const askBusinessType = await composeLeadSalesReply({
          session,
          text: trimmedText,
          mode: "sales",
          flowInstruction: [
            "הלקוח רוצה הדגמה.",
            "שאל אותו בעברית טבעית וקצרה מה סוג העסק שלו: מסעדה, בר או בית קפה.",
            "שמור על ניסוח אנושי מגוון, לא טקסט קבוע.",
            "אל תתחיל את ההדגמה לפני שיש תשובה.",
          ].join("\n"),
        });
        await updateAdminSessionState(session.id, {
          state: ADMIN_LEAD_SALES,
          pending_action: "lead_sales",
          collected_data: {
            ...(session.collected_data || {}),
            lead_stage: "awaiting_demo_type",
          },
        });
        await sendAdminTextMessageRaw(adminPhone, askBusinessType);
        await pushAdminMessage(session.id, "assistant", askBusinessType);
        return;
      }

      const shouldMoveToDemo = session.state === ADMIN_LEAD_DEMO || explicitDemoIntent || contextualDemoIntent;
      let contextualDemoExit = false;
      if (session.state === ADMIN_LEAD_DEMO && !isDemoExitIntent(trimmedText)) {
        contextualDemoExit = await inferDemoExitFromContext({ session, text: trimmedText });
      }
      const demoExitRequested = session.state === ADMIN_LEAD_DEMO && (isDemoExitIntent(trimmedText) || contextualDemoExit);
      if (demoExitRequested) {
        const purchaseMessage = buildLeadPurchaseMessage();
        await updateAdminSessionState(session.id, {
          state: ADMIN_LEAD_SALES,
          pending_action: "lead_sales",
          collected_data: {
            ...(session.collected_data || {}),
            lead_stage: "purchase_offered",
          },
        });
        await markLeadConverted({ phone: adminPhone });
        await sendAdminTextMessageRaw(adminPhone, purchaseMessage);
        await pushAdminMessage(session.id, "assistant", purchaseMessage);
        return;
      }

      const businessAdoptionRequested = session.state === ADMIN_LEAD_DEMO && isBusinessAdoptionIntent(trimmedText);
      if (businessAdoptionRequested) {
        const purchaseMessage = buildLeadPurchaseMessage();
        await updateAdminSessionState(session.id, {
          state: ADMIN_LEAD_SALES,
          pending_action: "lead_sales",
          collected_data: {
            ...(session.collected_data || {}),
            lead_stage: "purchase_offered",
          },
        });
        await markLeadConverted({ phone: adminPhone });
        await sendAdminTextMessageRaw(adminPhone, purchaseMessage);
        await pushAdminMessage(session.id, "assistant", purchaseMessage);
        return;
      }

      if (isPurchaseIntent(trimmedText)) {
        const purchaseMessage = buildLeadPurchaseMessage();
        await updateAdminSessionState(session.id, {
          state: ADMIN_LEAD_SALES,
          pending_action: "lead_sales",
          collected_data: {
            ...(session.collected_data || {}),
            lead_stage: "purchase_offered",
          },
        });
        await markLeadConverted({ phone: adminPhone });
        await sendAdminTextMessageRaw(adminPhone, purchaseMessage);
        await pushAdminMessage(session.id, "assistant", purchaseMessage);
        return;
      }

      if (session.state === ADMIN_LEAD_DEMO && isDemoKickoffIntent(trimmedText)) {
        const demoBusinessType = normalizeDemoBusinessType(session.collected_data?.demo_business_type || "מסעדה");
        const kickoffMessage = [
          `מעולה, מעכשיו זו הדמיה של בוט השירות של ${demoBusinessType}.`,
          "שלח/י שאלה כמו שלקוח אמיתי היה שואל, למשל:",
          "- מה שעות הפתיחה?",
          "- יש כשרות?",
          "- אפשר להזמין שולחן להיום?",
        ].join("\n");
        await sendAdminTextMessageRaw(adminPhone, kickoffMessage);
        await pushAdminMessage(session.id, "assistant", kickoffMessage);
        return;
      }

      if ((session.state === ADMIN_LEAD_DEMO || shouldMoveToDemo) && isFullDemoFaqRequest(trimmedText)) {
        const demoBusinessType = normalizeDemoBusinessType(session.collected_data?.demo_business_type || trimmedText || "מסעדה");
        const faqItems = buildDemoFaqExamples(demoBusinessType);
        const faqMessage = buildDemoFaqMessage({ businessType: demoBusinessType, items: faqItems });
        const chunks = splitLongMessage(faqMessage);
        await updateAdminSessionState(session.id, {
          state: ADMIN_LEAD_DEMO,
          pending_action: "lead_sales",
          collected_data: {
            ...(session.collected_data || {}),
            demo_business_type: demoBusinessType,
            lead_stage: "demo_live",
            demo_reply_count: Number(session.collected_data?.demo_reply_count || 0) + 1,
          },
        });
        for (const chunk of chunks) {
          await sendAdminTextMessageRaw(adminPhone, chunk);
        }
        await pushAdminMessage(session.id, "assistant", chunks.join("\n\n"));
        return;
      }

      if ((session.state === ADMIN_LEAD_DEMO || shouldMoveToDemo) && isDemoFaqExamplesRequest(trimmedText)) {
        const demoBusinessType = normalizeDemoBusinessType(session.collected_data?.demo_business_type || "מסעדה");
        const faqItems = pickDemoFaqExamples(buildDemoFaqExamples(demoBusinessType), 6);
        const faqMessage = buildDemoFaqExamplesMessage({ businessType: demoBusinessType, items: faqItems });
        const chunks = splitLongMessage(faqMessage);
        await updateAdminSessionState(session.id, {
          state: ADMIN_LEAD_DEMO,
          pending_action: "lead_sales",
          collected_data: {
            ...(session.collected_data || {}),
            demo_business_type: demoBusinessType,
            lead_stage: "demo_live",
            demo_reply_count: Number(session.collected_data?.demo_reply_count || 0) + 1,
          },
        });
        for (const chunk of chunks) {
          await sendAdminTextMessageRaw(adminPhone, chunk);
        }
        await pushAdminMessage(session.id, "assistant", chunks.join("\n\n"));
        return;
      }

      if (shouldMoveToDemo && session.state !== ADMIN_LEAD_DEMO && isAffirmativeLeadIntent(trimmedText)) {
        const demoBusinessType = normalizeDemoBusinessType(session.collected_data?.demo_business_type || "מסעדה");
        const handoff = await composeLeadSalesReply({
          session,
          text: trimmedText,
          mode: "sales",
          flowInstruction: [
            "הלקוח אישר להתחיל הדגמה.",
            `כתוב הודעת מעבר קצרה ואנושית בעברית תקינה עבור ${businessTypeWithArticle(demoBusinessType)}.`,
            "אל תיתן עכשיו בלוק מידע כללי על העסק.",
            "במקום זה, הזמן אותו לשלוח את השאלה הראשונה כלקוח אמיתי (למשל: שעות, תפריט, כשרות, הזמנה).",
            "שמור על ניסוח טבעי ולא תבניתי.",
          ].join("\n"),
        });
        await updateAdminSessionState(session.id, {
          state: ADMIN_LEAD_DEMO,
          pending_action: "lead_sales",
          collected_data: {
            ...(session.collected_data || {}),
            demo_business_type: demoBusinessType,
            lead_stage: "demo_live",
            demo_reply_count: 0,
          },
        });
        await sendAdminTextMessageRaw(adminPhone, handoff);
        await pushAdminMessage(session.id, "assistant", handoff);
        return;
      }

      const mode = shouldMoveToDemo ? "demo" : "sales";
      const flowInstruction = shouldMoveToDemo
        ? [
          "ענה כנציג המסעדה בלבד, בתשובה אחת קצרה וטבעית.",
          "אל לתאר את ההדגמה או 'מה הלקוח רואה' – רק לענות על השאלה עם הנתונים (שעות, כשרות, תפריט וכו') או תשובה סבירה.",
          "על שאלות שלא קשורות למסעדה (פוליטיקה וכו') החזר בעדינות לפוקוס.",
          "אתה כבר בתוך הדגמה פעילה: אסור להציע להתחיל הדגמה, אסור להציע הדגמה נוספת, ואסור לעבור לשיח מכירה או רכישה מיוזמתך.",
          "אל תכתוב ניסוחים כמו: 'אם תרצה הדגמה', 'אנחנו כאן לדבר על בוט', או כל ניסוח מכירתי.",
        ].join("\n")
        : [
          "שמור על טון אנושי, שנון ומגוון.",
          "אל תחזור על ניסוחים קבועים.",
          "אל תציע הדגמה שוב אם כבר הייתה, אלא רק לפי בקשה מפורשת של הלקוח.",
        ].join("\n");
      const aiReply = await composeLeadSalesReply({ session, text: trimmedText, mode, flowInstruction });
      let finalReply = String(aiReply || "").trim();
      const currentDemoReplyCount = Number(session.collected_data?.demo_reply_count || 0);
      const nextDemoReplyCount = shouldMoveToDemo ? currentDemoReplyCount + 1 : 0;
      if (shouldMoveToDemo && nextDemoReplyCount > 0 && nextDemoReplyCount % 10 === 0) {
        const continueOrExitPrompt = await composeLeadSalesReply({
          session,
          text: trimmedText,
          mode: "sales",
          flowInstruction: [
            "הלקוח נמצא בתוך הדגמה פעילה וכבר היו 10 תשובות בדמו.",
            "כתוב שורת פולואפ אחת טבעית שמציעה לבחור: להמשיך בהדגמה או לצאת מהדגמה ולחזור לשיחת מכירה.",
            "אל תשתמש בנוסח קשיח, שמור על סגנון אנושי.",
          ].join("\n"),
        });
        finalReply = [
          finalReply,
          String(continueOrExitPrompt || "").trim(),
        ].join("\n\n");
      }

      await updateAdminSessionState(session.id, {
        state: shouldMoveToDemo ? ADMIN_LEAD_DEMO : ADMIN_LEAD_SALES,
        pending_action: "lead_sales",
        collected_data: {
          ...(session.collected_data || {}),
          lead_stage: shouldMoveToDemo ? "demo_live" : "chatting",
          demo_reply_count: nextDemoReplyCount,
        },
      });
      await sendAdminTextMessageRaw(adminPhone, finalReply);
      await pushAdminMessage(session.id, "assistant", finalReply);
      return;
    }

    if (session.state === ADMIN_ONBOARDING_SKIP_SELECT) {
      const selectablePlan = getOnboardingQuestionPlan(session.collected_data || {}).filter((q) => q.key !== "venue_style");
      const indexes = parseSkipIndexes(trimmedText, selectablePlan.length);
      const requestedSkipKeys = indexes.map((idx) => selectablePlan[idx - 1]?.key).filter(Boolean);
      const blocked = requestedSkipKeys;
      const allowed = [];

      const merged = {
        ...(session.collected_data || {}),
        skipped_question_keys: allowed,
        skip_selection_done: true,
      };

      await updateAdminSessionState(session.id, {
        state: ADMIN_ONBOARDING,
        pending_action: "onboarding",
        collected_data: merged,
        restaurant_id: "__onboarding__",
      });

      if (blocked.length > 0) {
        const blockedLabels = blocked
          .map((key) => getQuestionByKey(key, merged))
          .filter(Boolean)
          .map((q) => onboardingQuestionLabel(q))
          .join(" | ");
        await sendAdminTextMessage(adminPhone, "שים לב: בתהליך הפיילוט כל סעיפי ההקמה חשובים ולא ניתנים לדילוג:");
        await sendAdminTextMessageRaw(adminPhone, blockedLabels);
      }

      const nextQuestion = await getNextOnboardingQuestionText(merged);
      if (!nextQuestion) {
        const summary = buildOnboardingSummary(merged);
        await updateAdminSessionState(session.id, {
          state: ADMIN_ONBOARDING_CONFIRM,
          pending_action: "onboarding",
          collected_data: merged,
          restaurant_id: "__onboarding__",
        });
        await sendAdminTextMessageRaw(adminPhone, summary);
        return;
      }
      await sendAdminTextMessage(adminPhone, "מעולה, ממשיכים.");
      await sendAdminTextMessageRaw(adminPhone, nextQuestion);
      return;
    }

    if (session.state === ADMIN_ONBOARDING_EDIT_SELECT) {
      const plan = getOnboardingQuestionPlan(session.collected_data || {});
      const indexes = parseQuestionIndexes(trimmedText, plan.length);
      if (indexes.length === 0) {
        await sendAdminTextMessage(adminPhone, "לא הצלחתי להבין אילו סעיפים לעדכן. כתוב מספרי סעיפים, למשל: 2,4");
        await sendAdminTextMessageRaw(adminPhone, onboardingFieldsListText(session.collected_data || {}));
        return;
      }

      const editQueue = indexes
        .map((idx) => plan[idx - 1])
        .filter(Boolean)
        .map((q) => q.key);
      if (editQueue.length === 0) {
        await sendAdminTextMessage(adminPhone, "לא מצאתי סעיפים תקינים לעדכון. נסה שוב.");
        return;
      }
      const firstIdx = indexes[0];
      await updateAdminSessionState(session.id, {
        state: ADMIN_ONBOARDING_EDIT_ANSWER,
        pending_action: "onboarding",
        collected_data: {
          ...(session.collected_data || {}),
          edit_queue: editQueue,
          edit_queue_pos: 0,
          pending_onboarding_review: null,
        },
        restaurant_id: "__onboarding__",
      });
      const firstQuestion = plan[firstIdx - 1];
      const firstQuestionText = firstQuestion
        ? await getOnboardingQuestionTextByKey(firstQuestion.key, session.collected_data || {})
        : "כתוב תשובה מעודכנת.";
      await sendAdminTextMessage(adminPhone, `מעולה. נעדכן את סעיף ${firstIdx}.`);
      await sendAdminTextMessageRaw(adminPhone, firstQuestionText);
      return;
    }

    if (session.state === ADMIN_ONBOARDING_EDIT_ANSWER) {
      const merged = { ...(session.collected_data || {}) };
      const editQueue = Array.isArray(merged.edit_queue) ? merged.edit_queue : [];
      const pos = Number(merged.edit_queue_pos || 0);
      const keyToEdit = editQueue[pos];
      if (!keyToEdit) {
        const summary = buildOnboardingSummary(merged);
        await updateAdminSessionState(session.id, {
          state: ADMIN_ONBOARDING_CONFIRM,
          pending_action: "onboarding",
          collected_data: merged,
          restaurant_id: "__onboarding__",
        });
        await sendAdminTextMessageRaw(adminPhone, summary);
        return;
      }

      const pendingReview = merged.pending_onboarding_review;
      if (pendingReview && pendingReview.mode === "edit" && pendingReview.key === keyToEdit) {
        const confirmation = normalizeYesNo(trimmedText);
        if (confirmation !== "yes" && confirmation !== "no") {
          await sendAdminTextMessage(adminPhone, "כדי להמשיך, ענה 'כן' אם הניסוח תקין או 'לא' כדי לנסח מחדש.");
          return;
        }
        if (confirmation === "no") {
          const nextCollected = {
            ...merged,
            pending_onboarding_review: null,
          };
          await updateAdminSessionState(session.id, {
            state: ADMIN_ONBOARDING_EDIT_ANSWER,
            pending_action: "onboarding",
            collected_data: nextCollected,
            restaurant_id: "__onboarding__",
          });
          await sendAdminTextMessageRaw(adminPhone, await getOnboardingQuestionTextByKey(keyToEdit, nextCollected));
          return;
        }

        const approvedValue = String(pendingReview.value || "").trim();
        const postReviewMerged = {
          ...merged,
          [keyToEdit]: approvedValue,
          pending_onboarding_review: null,
        };
        const cleanedMerged = clearDependentOnboardingAnswers(postReviewMerged, keyToEdit, approvedValue);

        let nextPos = pos + 1;
        while (nextPos < editQueue.length) {
          const candidateKey = editQueue[nextPos];
          if (getQuestionByKey(candidateKey, cleanedMerged)) break;
          nextPos += 1;
        }
        if (nextPos >= editQueue.length) {
          const summary = buildOnboardingSummary(cleanedMerged);
          await updateAdminSessionState(session.id, {
            state: ADMIN_ONBOARDING_CONFIRM,
            pending_action: "onboarding",
            collected_data: {
              ...cleanedMerged,
              edit_queue: [],
              edit_queue_pos: 0,
            },
            restaurant_id: "__onboarding__",
          });
          await sendAdminTextMessage(adminPhone, "מעולה, עדכנתי.");
          await sendAdminTextMessageRaw(adminPhone, summary);
          return;
        }

        const nextKey = editQueue[nextPos];
        const currentPlan = getOnboardingQuestionPlan(cleanedMerged);
        const nextIndex = currentPlan.findIndex((q) => q.key === nextKey);
        await updateAdminSessionState(session.id, {
          state: ADMIN_ONBOARDING_EDIT_ANSWER,
          pending_action: "onboarding",
          collected_data: {
            ...cleanedMerged,
            edit_queue: editQueue,
            edit_queue_pos: nextPos,
          },
          restaurant_id: "__onboarding__",
        });
        await sendAdminTextMessage(adminPhone, "מעולה, עדכנתי.");
        await sendAdminTextMessage(adminPhone, `עכשיו נעדכן את סעיף ${nextIndex + 1}.`);
        await sendAdminTextMessageRaw(
          adminPhone,
          nextIndex >= 0
            ? await getOnboardingQuestionTextByKey(currentPlan[nextIndex].key, cleanedMerged)
            : "כתוב תשובה מעודכנת."
        );
        return;
      }

      if (keyToEdit === "manager_code") {
        const validation = validateManagerCode(trimmedText);
        if (!validation.valid) {
          await sendAdminTextMessageRaw(adminPhone, validation.message);
          return;
        }
      }

      const normalized = await normalizeOnboardingAnswer({
        fieldKey: keyToEdit,
        rawAnswer: trimmedText,
        collectedData: merged,
        recentMessages: session.messages || [],
      });
      if (normalized.needsClarification && normalized.clarificationQuestion) {
        const { attempts, nextCount } = nextIrrelevantAttemptData(merged, keyToEdit);
        if (nextCount >= 2) {
          const accepted = normalized.normalizedAnswer || trimmedText;
          merged.irrelevant_attempts = { ...attempts, [keyToEdit]: 0 };
          const fieldValidationAfterForce = validateOnboardingField(keyToEdit, accepted);
          if (!fieldValidationAfterForce.valid) {
            await sendAdminTextMessageRaw(adminPhone, fieldValidationAfterForce.message);
            return;
          }
          merged[keyToEdit] = accepted;
          await sendAdminTextMessage(
            adminPhone,
            "שים לב: התשובה נראתה פחות קשורה לשאלה, אבל קיבלתי אותה לפי בקשתך וממשיכים."
          );
        } else {
          await updateAdminSessionState(session.id, {
            state: ADMIN_ONBOARDING_EDIT_ANSWER,
            pending_action: "onboarding",
            collected_data: {
              ...merged,
              irrelevant_attempts: attempts,
              edit_queue: editQueue,
              edit_queue_pos: pos,
            },
            restaurant_id: "__onboarding__",
          });
          await sendAdminTextMessageRaw(adminPhone, normalized.clarificationQuestion);
          return;
        }
      } else {
        const attempts = { ...((merged && merged.irrelevant_attempts) || {}) };
        attempts[keyToEdit] = 0;
        merged.irrelevant_attempts = attempts;
      }
      const answerToValidate = String(normalized.normalizedAnswer || "").trim() || trimmedText;
      const fieldValidation = validateOnboardingField(keyToEdit, answerToValidate);
      if (!fieldValidation.valid) {
        await sendAdminTextMessageRaw(adminPhone, fieldValidation.message);
        return;
      }
      await updateAdminSessionState(session.id, {
        state: ADMIN_ONBOARDING_EDIT_ANSWER,
        pending_action: "onboarding",
        collected_data: {
          ...merged,
          edit_queue: editQueue,
          edit_queue_pos: pos,
          pending_onboarding_review: {
            mode: "edit",
            key: keyToEdit,
            value: answerToValidate,
          },
        },
        restaurant_id: "__onboarding__",
      });
      await sendAdminTextMessageRaw(adminPhone, buildOnboardingReviewMessage(keyToEdit, answerToValidate, merged));
      return;
    }

    if (session.state === ADMIN_ONBOARDING_CONFIRM) {
      const confirmation = normalizeYesNo(trimmedText);
      if (confirmation === "no" || isOnboardingEditIntent(trimmedText)) {
        await updateAdminSessionState(session.id, {
          state: ADMIN_ONBOARDING_EDIT_SELECT,
          pending_action: "onboarding",
          collected_data: {
            ...(session.collected_data || {}),
            edit_queue: [],
            edit_queue_pos: 0,
            pending_onboarding_review: null,
          },
          restaurant_id: "__onboarding__",
        });
        const editPrompt = [
          "אין בעיה. אילו סעיפים תרצה לשנות?",
          "כתוב מספרי סעיפים, למשל: 2,4",
          "",
          onboardingFieldsListText(session.collected_data || {}),
        ].join("\n");
        await sendAdminTextMessageRaw(adminPhone, editPrompt);
        return;
      }
      if (confirmation !== "yes") {
        await sendAdminTextMessage(adminPhone, "לאישור ההקמה כתוב 'כן'. לשינוי סעיפים כתוב 'לא' או 'ערוך'.");
        return;
      }

      const inviteCode = session.collected_data?.invite_code;
      if (!inviteCode) {
        await resetAdminSession(session.id);
        await sendAdminTextMessage(adminPhone, "לא מצאתי קוד הזמנה בתהליך. שלח שוב קוד הזמנה כדי להתחיל.");
        return;
      }

      const payload = buildProvisionPayload({
        collectedData: session.collected_data || {},
        adminPhone,
        inviteCode,
      });
      const managerCode = String(session.collected_data?.manager_code || "").trim();
      const managerCodeValidation = validateManagerCode(managerCode);
      if (!managerCodeValidation.valid) {
        await sendAdminTextMessage(adminPhone, "לפני אישור סופי חייבים לבחור קוד מנהל תקין.");
        await sendAdminTextMessageRaw(
          adminPhone,
          await getOnboardingQuestionTextByKey("manager_code", session.collected_data || {})
        );
        await updateAdminSessionState(session.id, {
          state: ADMIN_ONBOARDING_EDIT_ANSWER,
          pending_action: "onboarding",
          collected_data: {
            ...(session.collected_data || {}),
            edit_queue: ["manager_code"],
            edit_queue_pos: 0,
          },
          restaurant_id: "__onboarding__",
        });
        return;
      }

      if (DIALOG_INTEGRATION_ENABLED && !String(session.collected_data?.whatsapp_phone_number_id || "").trim()) {
        const connectMessage = [
          "*נשאר שלב אחרון לפני הפעלה:* חיבור מספר הוואטסאפ דרך 360dialog.",
          "כל פרטי העסק כבר נאספו ונשמרו בתהליך. אחרי החיבור אציג לך שוב סיכום לאישור סופי.",
          DIALOG_EMBEDDED_SIGNUP_URL
            ? `קישור לחיבור: ${DIALOG_EMBEDDED_SIGNUP_URL}`
            : "לא מוגדר כרגע קישור חיבור במערכת.",
          "אחרי שהחיבור הושלם כתוב כאן: מוכן",
        ].join("\n");
        await updateAdminSessionState(session.id, {
          state: ADMIN_AWAITING_NUMBER_CONNECT,
          pending_action: "onboarding",
          collected_data: {
            ...(session.collected_data || {}),
          },
          restaurant_id: "__onboarding__",
        });
        await sendAdminTextMessageRaw(adminPhone, connectMessage);
        return;
      }

      const { hash: managerCodeHash, salt: managerCodeSalt } = hashManagerCode(managerCode);
      payload.manager_code_hash = managerCodeHash;
      payload.manager_code_salt = managerCodeSalt;
      payload.manager_auth_enabled = true;
      let telegramConnectCode = "";
      try {
        await provisionRestaurant(payload);
        telegramConnectCode = await createTelegramConnectCode({
          restaurantId: payload.restaurant_id,
          createdBy: adminPhone,
        });
        await redeemInviteCode({ code: inviteCode, usedBy: adminPhone });
      } catch (setupError) {
        await db.collection("restaurants").doc(payload.restaurant_id).set({
          status: "SETUP_FAILED",
          setup_error: setupError.message,
          failed_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        logger.error("Onboarding provisioning failed", {
          restaurantId: payload.restaurant_id,
          adminPhone,
          error: setupError.message,
        });
        await sendAdminTextMessageRaw(
          adminPhone,
          "לא הצלחתי להשלים את ההקמה בגלל תקלה בשמירת העסק. העסק לא הופעל. אפשר לנסות שוב בעוד רגע או לפנות לתמיכה."
        );
        return;
      }
      const successLines = [
        "*העסק הוקם בהצלחה*",
        "",
        "*פרטי העסק:*",
        `• מזהה עסק: ${payload.restaurant_id}`,
        `• שם העסק: ${payload.name}`,
        "",
        "*קוד ניהול:*",
        `• ${managerCode}`,
        "הקוד הזה מיועד להתחברות וניהול העסק בבוט הניהול. שמור אותו במקום בטוח.",
        "",
        "*קוד חיבור לטלגרם:*",
        `• ${telegramConnectCode}`,
        "הקוד הזה מיועד רק לחיבור קבוצת הטלגרם של הנציגים. הוא חד-פעמי ונפרד מקוד הניהול.",
        "",
        buildTelegramInstructions(telegramConnectCode),
      ];
      const guideLink = String(env.ONBOARDING_GUIDE_LINK || "").trim();
      if (guideLink) {
        successLines.push("");
        successLines.push(`קישור להדרכה: ${guideLink}`);
      }
      successLines.push("");
      successLines.push("כל הפרטים יישלחו גם במייל עם חיבור מערכת הדיוור.");
      successLines.push("אפשר להתחיל לעדכן אותי בפרטים נוספים בכל רגע.");
      try {
        await sendAdminTextMessageRaw(adminPhone, successLines.join("\n"));
      } catch (sendError) {
        logger.warn("Onboarding provisioned but success message failed", {
          adminPhone,
          error: sendError.message,
        });
      }
      await resetAdminSession(session.id);
      return;
    }

    if (session.state === ADMIN_ONBOARDING) {
      const merged = { ...(session.collected_data || {}) };
      let workingMerged = { ...merged };
      const pendingReview = merged.pending_onboarding_review;
      let acceptedKey = "";

      if (pendingReview && pendingReview.mode === "onboarding" && pendingReview.key) {
        const confirmation = normalizeYesNo(trimmedText);
        if (confirmation !== "yes" && confirmation !== "no") {
          await sendAdminTextMessage(adminPhone, "כדי להמשיך, ענה 'כן' אם הניסוח תקין או 'לא' כדי לנסח מחדש.");
          return;
        }
        if (confirmation === "no") {
          const retryCollected = {
            ...merged,
            pending_onboarding_review: null,
          };
          await updateAdminSessionState(session.id, {
            state: ADMIN_ONBOARDING,
            pending_action: "onboarding",
            collected_data: retryCollected,
            restaurant_id: "__onboarding__",
          });
          await sendAdminTextMessageRaw(
            adminPhone,
            await getOnboardingQuestionTextByKey(pendingReview.key, retryCollected)
          );
          return;
        }
        const approvedValue = String(pendingReview.value || "").trim();
        acceptedKey = String(pendingReview.key || "").trim();
        const approvedMerged = {
          ...merged,
          [acceptedKey]: approvedValue,
          pending_onboarding_review: null,
        };
        workingMerged = clearDependentOnboardingAnswers(approvedMerged, acceptedKey, approvedValue);
      } else {
        const nextKey = getNextOnboardingQuestionKey(merged);
        if (!nextKey) {
          const summary = buildOnboardingSummary(workingMerged);
          await updateAdminSessionState(session.id, {
            state: ADMIN_ONBOARDING_CONFIRM,
            pending_action: "onboarding",
            collected_data: workingMerged,
            restaurant_id: "__onboarding__",
          });
          await sendAdminTextMessageRaw(adminPhone, summary);
          await pushAdminMessage(session.id, "assistant", summary);
          return;
        }

        if (nextKey === "manager_code") {
          const validation = validateManagerCode(trimmedText);
          if (!validation.valid) {
            await sendAdminTextMessageRaw(adminPhone, validation.message);
            return;
          }
        }
        const normalized = await normalizeOnboardingAnswer({
          fieldKey: nextKey,
          rawAnswer: trimmedText,
          collectedData: merged,
          recentMessages: session.messages || [],
        });
        if (normalized.needsClarification && normalized.clarificationQuestion) {
          const { attempts, nextCount } = nextIrrelevantAttemptData(merged, nextKey);
          if (nextCount >= 2) {
            const accepted = normalized.normalizedAnswer || trimmedText;
            merged.irrelevant_attempts = { ...attempts, [nextKey]: 0 };
            const fieldValidationAfterForce = validateOnboardingField(nextKey, accepted);
            if (!fieldValidationAfterForce.valid) {
              await sendAdminTextMessageRaw(adminPhone, fieldValidationAfterForce.message);
              return;
            }
            merged[nextKey] = accepted;
            workingMerged = clearDependentOnboardingAnswers(merged, nextKey, accepted);
            await sendAdminTextMessage(
              adminPhone,
              "שים לב: התשובה נראתה פחות קשורה לשאלה, אבל קיבלתי אותה לפי בקשתך וממשיכים."
            );
          } else {
            await updateAdminSessionState(session.id, {
              state: ADMIN_ONBOARDING,
              pending_action: "onboarding",
              collected_data: {
                ...merged,
                irrelevant_attempts: attempts,
              },
              restaurant_id: "__onboarding__",
            });
            await sendAdminTextMessageRaw(adminPhone, normalized.clarificationQuestion);
            return;
          }
        } else {
          const attempts = { ...((merged && merged.irrelevant_attempts) || {}) };
          attempts[nextKey] = 0;
          merged.irrelevant_attempts = attempts;
        }
        const answerToValidate = String(normalized.normalizedAnswer || "").trim() || trimmedText;
        const fieldValidation = validateOnboardingField(nextKey, answerToValidate);
        if (!fieldValidation.valid) {
          await sendAdminTextMessageRaw(adminPhone, fieldValidation.message);
          return;
        }
        await updateAdminSessionState(session.id, {
          state: ADMIN_ONBOARDING,
          pending_action: "onboarding",
          collected_data: {
            ...merged,
            pending_onboarding_review: {
              mode: "onboarding",
              key: nextKey,
              value: answerToValidate,
            },
          },
          restaurant_id: "__onboarding__",
        });
        await sendAdminTextMessageRaw(adminPhone, buildOnboardingReviewMessage(nextKey, answerToValidate, merged));
        return;
      }

      if (!isComplete(workingMerged)) {
        const nextQuestion = await getNextOnboardingQuestionText(workingMerged);
        await updateAdminSessionState(session.id, {
          state: ADMIN_ONBOARDING,
          pending_action: "onboarding",
          collected_data: workingMerged,
          restaurant_id: "__onboarding__",
        });
        if (acceptedKey) await sendAdminTextMessage(adminPhone, "מעולה, עדכנתי.");
        await sendAdminTextMessageRaw(adminPhone, onboardingProgressText(workingMerged));
        await sendAdminTextMessageRaw(adminPhone, nextQuestion);
        await pushAdminMessage(session.id, "assistant", nextQuestion);
        return;
      }

      const summary = buildOnboardingSummary(workingMerged);
      await updateAdminSessionState(session.id, {
        state: ADMIN_ONBOARDING_CONFIRM,
        pending_action: "onboarding",
        collected_data: workingMerged,
        restaurant_id: "__onboarding__",
      });
      if (acceptedKey) await sendAdminTextMessage(adminPhone, "מעולה, עדכנתי.");
      await sendAdminTextMessageRaw(adminPhone, summary);
      await pushAdminMessage(session.id, "assistant", summary);
      return;
    }

    if (session.state === ADMIN_LOGIN_ASK_RESTAURANT_ID) {
      const restaurantIdCandidate = String(trimmedText || "").trim();
      const loginRestaurant = await findRestaurantById(restaurantIdCandidate);
      if (!loginRestaurant) {
        const failed = Number(session.collected_data?.failed_login_attempts || 0) + 1;
        const shouldLock = failed >= ADMIN_LOGIN_MAX_FAILURES;
        const remaining = Math.max(0, ADMIN_LOGIN_MAX_FAILURES - failed);
        await updateAdminSessionState(session.id, {
          state: shouldLock ? ADMIN_IDLE : ADMIN_LOGIN_ASK_RESTAURANT_ID,
          pending_action: null,
          collected_data: {
            ...(session.collected_data || {}),
            failed_login_attempts: failed,
            locked_until: shouldLock ? Date.now() + ADMIN_LOGIN_LOCK_MS : null,
            next_login_attempt_at: Date.now() + ADMIN_LOGIN_MIN_INTERVAL_MS,
            login_restaurant_id: null,
          },
        });
        if (shouldLock) {
          await sendAdminTextMessage(adminPhone, "בוצעו יותר מדי ניסיונות שגויים. החשבון ננעל ל-10 דקות.");
          return;
        }
        await sendAdminTextMessage(
          adminPhone,
          `לא מצאתי עסק עם המזהה הזה. נסה שוב.\nנותרו לך עוד ${remaining} ניסיונות לפני נעילה זמנית.`
        );
        return;
      }

      if (!loginRestaurant.manager_code_hash || !loginRestaurant.manager_code_salt) {
        await sendAdminTextMessage(
          adminPhone,
          "העסק נמצא, אבל עדיין לא מוגדר קוד מנהל. בצע הקמה מחדש או פנה לתמיכה לאיפוס הרשאות."
        );
        return;
      }

      const loginRestaurantId = loginRestaurant.restaurant_id || loginRestaurant.id;
      await updateAdminSessionState(session.id, {
        state: ADMIN_LOGIN_ASK_MANAGER_CODE,
        pending_action: null,
        collected_data: {
          ...(session.collected_data || {}),
          login_restaurant_id: loginRestaurantId,
          failed_login_attempts: 0,
          next_login_attempt_at: null,
        },
      });
      await sendAdminTextMessage(adminPhone, "מעולה. עכשיו הזן את קוד המנהל.");
      return;
    }

    if (session.state === ADMIN_LOGIN_ASK_MANAGER_CODE) {
      const loginRestaurantId = session.collected_data?.login_restaurant_id;
      if (!loginRestaurantId) {
        await updateAdminSessionState(session.id, {
          state: ADMIN_LOGIN_ASK_RESTAURANT_ID,
          pending_action: null,
          collected_data: {
            ...(session.collected_data || {}),
            login_restaurant_id: null,
          },
        });
        await sendAdminTextMessage(adminPhone, "לא מצאתי מזהה עסק בתהליך. הזן שוב מזהה עסק כדי להתחבר.");
        return;
      }

      const loginRestaurant = await findRestaurantById(loginRestaurantId);
      const verified = loginRestaurant
        && verifyManagerCode(trimmedText, loginRestaurant.manager_code_hash, loginRestaurant.manager_code_salt);
      if (!verified) {
        const failed = Number(session.collected_data?.failed_login_attempts || 0) + 1;
        const shouldLock = failed >= ADMIN_LOGIN_MAX_FAILURES;
        const remaining = Math.max(0, ADMIN_LOGIN_MAX_FAILURES - failed);
        await updateAdminSessionState(session.id, {
          state: shouldLock ? ADMIN_IDLE : ADMIN_LOGIN_ASK_MANAGER_CODE,
          pending_action: null,
          collected_data: {
            ...(session.collected_data || {}),
            failed_login_attempts: failed,
            locked_until: shouldLock ? Date.now() + ADMIN_LOGIN_LOCK_MS : null,
            next_login_attempt_at: Date.now() + ADMIN_LOGIN_MIN_INTERVAL_MS,
          },
        });
        if (shouldLock) {
          await sendAdminTextMessage(adminPhone, "בוצעו יותר מדי ניסיונות שגויים. החשבון ננעל ל-10 דקות.");
          return;
        }
        await sendAdminTextMessage(
          adminPhone,
          `קוד מנהל שגוי. נסה שוב או כתוב 'שכחתי קוד'.\nנותרו לך עוד ${remaining} ניסיונות לפני נעילה זמנית.`
        );
        return;
      }

      const restaurantId = loginRestaurant.restaurant_id || loginRestaurant.id;
      await updateAdminSessionState(session.id, {
        state: ADMIN_IDLE,
        pending_action: null,
        restaurant_id: restaurantId,
        collected_data: {
          ...(session.collected_data || {}),
          authenticated_restaurant_id: restaurantId,
          auth_at: Date.now(),
          awaiting_manager_code: false,
          login_restaurant_id: null,
          failed_login_attempts: 0,
          locked_until: null,
          next_login_attempt_at: null,
        },
      });
      await sendAdminTextMessage(adminPhone, `התחברת בהצלחה לעסק ${loginRestaurant.name || restaurantId}. איך אפשר לעזור?`);
      return;
    }

    if (loginStartRequested || loginCommand) {
      if (loginCommand) {
        const prefetchedRestaurant = await findRestaurantById(loginCommand.restaurantId);
        if (!prefetchedRestaurant) {
          const failed = Number(session.collected_data?.failed_login_attempts || 0) + 1;
          const shouldLock = failed >= ADMIN_LOGIN_MAX_FAILURES;
          const remaining = Math.max(0, ADMIN_LOGIN_MAX_FAILURES - failed);
          await updateAdminSessionState(session.id, {
            state: shouldLock ? ADMIN_IDLE : ADMIN_LOGIN_ASK_RESTAURANT_ID,
            pending_action: null,
            collected_data: {
              ...(session.collected_data || {}),
              failed_login_attempts: failed,
              locked_until: shouldLock ? Date.now() + ADMIN_LOGIN_LOCK_MS : null,
              next_login_attempt_at: Date.now() + ADMIN_LOGIN_MIN_INTERVAL_MS,
              login_restaurant_id: null,
            },
          });
          if (shouldLock) {
            await sendAdminTextMessage(adminPhone, "בוצעו יותר מדי ניסיונות שגויים. החשבון ננעל ל-10 דקות.");
            return;
          }
          await sendAdminTextMessage(
            adminPhone,
            `לא מצאתי עסק עם המזהה ששלחת.\nנותרו לך עוד ${remaining} ניסיונות לפני נעילה זמנית.`
          );
          return;
        }

        const prefetchedRestaurantId = prefetchedRestaurant.restaurant_id || prefetchedRestaurant.id;
        await updateAdminSessionState(session.id, {
          state: ADMIN_LOGIN_ASK_MANAGER_CODE,
          pending_action: null,
          collected_data: {
            ...(session.collected_data || {}),
            login_restaurant_id: prefetchedRestaurantId,
            failed_login_attempts: 0,
            next_login_attempt_at: null,
          },
        });
        await sendAdminTextMessage(adminPhone, "זיהיתי את מזהה העסק. עכשיו הזן את קוד המנהל.");
        return;
      }

      await updateAdminSessionState(session.id, {
        state: ADMIN_LOGIN_ASK_RESTAURANT_ID,
        pending_action: null,
        collected_data: {
          ...(session.collected_data || {}),
          login_restaurant_id: null,
        },
      });
      await sendAdminTextMessage(adminPhone, "מעולה, נתחבר לעסק קיים. כתוב את מזהה העסק (restaurant_id).");
      return;
    }

    const inviteInput = isPotentialInviteCode(trimmedText) ? trimmedText : extractInviteCodeCandidate(trimmedText);
    const invite = await getPendingInviteCode(inviteInput);
    if (!invite) {
      if (isInviteCodeHelpIntent(trimmedText)) {
        await sendAdminTextMessageRaw(
          adminPhone,
          "ברור. כדי להתחיל, שלח/י לי את קוד ההזמנה עצמו (5-12 תווים באנגלית/מספרים), למשל: AB12CD."
        );
        return;
      }
      await startLeadSalesIntro({ session, adminPhone });
      return;
    }

    await startOnboardingFromInvite({ session, adminPhone, invite });
    return;
  }

  let restaurant = null;
  let restaurantId = null;
  let authValid = isAuthValid(session);

  if (authValid) {
    restaurant = await findRestaurantById(session.collected_data.authenticated_restaurant_id);
    authValid = Boolean(restaurant);
  }

  if (!authValid) {
    if (session.collected_data?.authenticated_restaurant_id) {
      await updateAdminSessionState(session.id, {
        state: ADMIN_IDLE,
        pending_action: null,
        collected_data: {
          ...(session.collected_data || {}),
          authenticated_restaurant_id: null,
          auth_at: null,
          awaiting_manager_code: false,
          login_restaurant_id: null,
        },
      });
      session.state = ADMIN_IDLE;
      session.pending_action = null;
      session.collected_data = {
        ...(session.collected_data || {}),
        authenticated_restaurant_id: null,
        auth_at: null,
        awaiting_manager_code: false,
        login_restaurant_id: null,
      };
      await sendAdminTextMessage(adminPhone, "פג תוקף הסשן. להתחברות מחדש הזן קוד מנהל.");
    }

    if (loginCommand) {
      const loginRestaurant = await findRestaurantById(loginCommand.restaurantId);
      if (!loginRestaurant || !verifyManagerCode(loginCommand.managerCode, loginRestaurant.manager_code_hash, loginRestaurant.manager_code_salt)) {
        const failed = Number(session.collected_data?.failed_login_attempts || 0) + 1;
        const shouldLock = failed >= ADMIN_LOGIN_MAX_FAILURES;
        const remaining = Math.max(0, ADMIN_LOGIN_MAX_FAILURES - failed);
        await updateAdminSessionState(session.id, {
          collected_data: {
            ...(session.collected_data || {}),
            failed_login_attempts: failed,
            locked_until: shouldLock ? Date.now() + ADMIN_LOGIN_LOCK_MS : null,
            next_login_attempt_at: Date.now() + ADMIN_LOGIN_MIN_INTERVAL_MS,
          },
        });
        if (shouldLock) {
          await sendAdminTextMessage(adminPhone, "בוצעו יותר מדי ניסיונות שגויים. החשבון ננעל ל-10 דקות.");
          return;
        }
        await sendAdminTextMessage(
          adminPhone,
          `התחברות נכשלה. בדוק מזהה עסק וקוד מנהל ונסה שוב.\nנותרו לך עוד ${remaining} ניסיונות לפני נעילה זמנית.`
        );
        return;
      }
      restaurant = loginRestaurant;
      restaurantId = restaurant.restaurant_id || restaurant.id;
      await updateAdminSessionState(session.id, {
        state: ADMIN_IDLE,
        pending_action: null,
        restaurant_id: restaurantId,
        collected_data: {
          ...(session.collected_data || {}),
          authenticated_restaurant_id: restaurantId,
          auth_at: Date.now(),
          awaiting_manager_code: false,
          login_restaurant_id: null,
          failed_login_attempts: 0,
          locked_until: null,
          next_login_attempt_at: null,
        },
      });
      session.state = ADMIN_IDLE;
      session.pending_action = null;
      session.collected_data = {
        ...(session.collected_data || {}),
        authenticated_restaurant_id: restaurantId,
        auth_at: Date.now(),
        awaiting_manager_code: false,
        login_restaurant_id: null,
      };
      await sendAdminTextMessage(adminPhone, `התחברת בהצלחה לעסק ${restaurant.name || restaurantId}. איך אפשר לעזור?`);
      return;
    } else if (restaurantByPhone) {
      const phoneRestaurantId = restaurantByPhone.restaurant_id || restaurantByPhone.id;
      if (!restaurantByPhone.manager_code_hash || !restaurantByPhone.manager_code_salt) {
        restaurant = restaurantByPhone;
        restaurantId = phoneRestaurantId;
      } else {
        const awaiting = Boolean(session.collected_data?.awaiting_manager_code);
        const loginRestaurantId = session.collected_data?.login_restaurant_id || phoneRestaurantId;
        if (!awaiting) {
          await updateAdminSessionState(session.id, {
            state: ADMIN_IDLE,
            restaurant_id: phoneRestaurantId,
            collected_data: {
              ...(session.collected_data || {}),
              awaiting_manager_code: true,
              login_restaurant_id: phoneRestaurantId,
            },
          });
          await sendAdminTextMessage(adminPhone, "לפני שממשיכים, הזן קוד מנהל.");
          return;
        }

        const loginRestaurant = await findRestaurantById(loginRestaurantId);
        if (!loginRestaurant || !verifyManagerCode(trimmedText, loginRestaurant.manager_code_hash, loginRestaurant.manager_code_salt)) {
          const failed = Number(session.collected_data?.failed_login_attempts || 0) + 1;
          const shouldLock = failed >= ADMIN_LOGIN_MAX_FAILURES;
          const remaining = Math.max(0, ADMIN_LOGIN_MAX_FAILURES - failed);
          await updateAdminSessionState(session.id, {
            collected_data: {
              ...(session.collected_data || {}),
              failed_login_attempts: failed,
              locked_until: shouldLock ? Date.now() + ADMIN_LOGIN_LOCK_MS : null,
              next_login_attempt_at: Date.now() + ADMIN_LOGIN_MIN_INTERVAL_MS,
            },
          });
          if (shouldLock) {
            await sendAdminTextMessage(adminPhone, "בוצעו יותר מדי ניסיונות שגויים. החשבון ננעל ל-10 דקות.");
            return;
          }
          await sendAdminTextMessage(
            adminPhone,
            `קוד מנהל שגוי. נסה שוב או כתוב 'שכחתי קוד'.\nנותרו לך עוד ${remaining} ניסיונות לפני נעילה זמנית.`
          );
          return;
        }
        restaurant = loginRestaurant;
        restaurantId = loginRestaurant.restaurant_id || loginRestaurant.id;
        await updateAdminSessionState(session.id, {
          state: ADMIN_IDLE,
          pending_action: null,
          restaurant_id: restaurantId,
          collected_data: {
            ...(session.collected_data || {}),
            authenticated_restaurant_id: restaurantId,
            auth_at: Date.now(),
            awaiting_manager_code: false,
            login_restaurant_id: null,
            failed_login_attempts: 0,
            locked_until: null,
            next_login_attempt_at: null,
          },
        });
        session.state = ADMIN_IDLE;
        session.pending_action = null;
        session.collected_data = {
          ...(session.collected_data || {}),
          authenticated_restaurant_id: restaurantId,
          auth_at: Date.now(),
          awaiting_manager_code: false,
          login_restaurant_id: null,
        };
        await sendAdminTextMessage(adminPhone, `מעולה, זיהיתי אותך. מחובר לעסק ${restaurant.name || restaurantId}.`);
        return;
      }
    } else {
      await sendAdminTextMessage(
        adminPhone,
        "כדי להתחבר לעסק קיים כתוב 'כניסה' ואני אוביל אותך שלב-שלב.\nאם אין לך עסק עדיין - שלח קוד הזמנה."
      );
      return;
    }
  }

  if (!restaurant) {
    restaurant = restaurantByPhone;
  }
  restaurantId = restaurantId || (restaurant ? restaurant.restaurant_id || restaurant.id : null);
  if (!restaurant || !restaurantId) {
    await sendAdminTextMessage(adminPhone, "לא הצלחתי לזהות את העסק שלך. נסה להתחבר מחדש.");
    return;
  }

  const activeKnowledgeList = getActiveKnowledgeListState(session);
  if (activeKnowledgeList && isKnowledgeListContinueText(trimmedText)) {
    const page = await listKnowledgeItemsPage(
      restaurantId,
      Number(activeKnowledgeList.next_offset || 0),
      Number(activeKnowledgeList.page_size || KNOWLEDGE_LIST_PAGE_SIZE)
    );
    await updateAdminSessionState(session.id, {
      collected_data: {
        ...(session.collected_data || {}),
        knowledge_list_pagination: page.hasMore
          ? {
            next_offset: page.nextOffset,
            total: page.total,
            page_size: Number(activeKnowledgeList.page_size || KNOWLEDGE_LIST_PAGE_SIZE),
            expires_at: Date.now() + KNOWLEDGE_LIST_CONTINUE_TTL_MS,
          }
          : null,
      },
    });
    await sendAdminTextMessageRaw(adminPhone, page.text);
    await pushAdminMessage(session.id, "assistant", page.text);
    return;
  }

  if (session.state === ADMIN_ONBOARDING || session.state === ADMIN_ONBOARDING_CONFIRM) {
    await updateAdminSessionState(session.id, {
      state: ADMIN_IDLE,
      pending_action: null,
      collected_data: {},
      restaurant_id: restaurantId,
    });
    session.state = ADMIN_IDLE;
    session.collected_data = {};
  }

  const telegramCommand = parseTelegramAdminCommand(trimmedText);
  if (telegramCommand) {
    if (telegramCommand.action === "list") {
      const msg = buildTelegramRecipientsList(restaurant);
      await sendAdminTextMessageRaw(adminPhone, msg);
      await pushAdminMessage(session.id, "assistant", msg);
      return;
    }
    if (telegramCommand.action === "remove") {
      const result = await removeTelegramRecipient({ restaurantId, chatId: telegramCommand.chatId });
      await sendAdminTextMessage(adminPhone, result.message);
      return;
    }
    const connectCode = await createTelegramConnectCode({ restaurantId, createdBy: adminPhone });
    const msg = buildTelegramInstructions(connectCode);
    await sendAdminTextMessageRaw(adminPhone, msg);
    await pushAdminMessage(session.id, "assistant", msg);
    return;
  }

  if (session.state === ADMIN_SAVE_CONFIRM) {
    const confirmVal = text === "save_yes" ? "yes" : text === "save_no" ? "no" : normalizeYesNo(text);
    if (confirmVal === "yes") {
      const answer = session.collected_data?.admin_answer || "";
      const question = session.collected_data?.customer_question || "";
      const intentNote = session.collected_data?.knowledge_intent_note || "";
      const knowledgeEntry = await buildKnowledgeEntry({
        category: "custom",
        question,
        answer,
        intentNote,
      });
      const embedding = await createEmbedding(knowledgeEntry.embeddingText);
      await db.collection(`restaurants/${restaurantId}/Knowledge_Base`).add({
        category: "custom",
        content: knowledgeEntry.content,
        embedding,
        ...(knowledgeEntry.metadata || {}),
        intent_note: intentNote || null,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      invalidateCache(restaurantId);

      const qId = session.collected_data?.question_id;
      if (qId) {
        await db.collection("unanswered_questions").doc(qId).update({
          status: "RESOLVED",
          admin_answer: answer,
          resolved_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await updateAdminSessionState(session.id, {
        last_added_knowledge_content: knowledgeEntry.content,
        last_added_at: Date.now(),
      });
      await resetAdminSession(session.id);
      await sendAdminTextMessage(adminPhone, "התשובה נשמרה בבסיס הידע. בפעם הבאה הבוט ידע לענות על זה לבד 👍");
      return;
    }
    if (confirmVal === "no") {
      await resetAdminSession(session.id);
      await sendAdminTextMessage(adminPhone, "בסדר, התשובה נשלחה ללקוח אבל לא נשמרה בבסיס הידע.");
      return;
    }
    await sendAdminButtons({
      to: adminPhone,
      bodyText: "לשמור את השאלה והתשובה בבסיס הידע?",
      buttons: [
        { id: "save_yes", title: "כן, שמור" },
        { id: "save_no", title: "לא, דלג" },
      ],
      intent: "save_confirm_prompt",
    });
    return;
  }

  if (session.state === ADMIN_KNOWLEDGE_INTENT_CLARIFY) {
    const intentNote = isSkipClarifyText(trimmedText) ? "" : trimmedText;
    const origin = String(session.collected_data?.knowledge_clarify_origin || "");
    if (origin === "add_custom") {
      const merged = {
        ...(session.collected_data || {}),
        knowledge_intent_note: intentNote,
      };
      const out = await saveKnowledgeAction(restaurantId, "add_custom", merged);
      if (out && typeof out === "object" && out.savedContent) {
        await updateAdminSessionState(session.id, {
          last_added_knowledge_content: out.savedContent,
          last_added_at: Date.now(),
        });
      }
      await resetAdminSession(session.id);
      const msg = typeof out === "string" ? out : (out && out.message) || "נשמר בהצלחה בבסיס הידע.";
      await pushAdminMessage(session.id, "assistant", msg);
      await sendAdminTextMessageRaw(adminPhone, msg);
      return;
    }
    await updateAdminSessionState(session.id, {
      state: ADMIN_SAVE_CONFIRM,
      collected_data: {
        ...session.collected_data,
        knowledge_intent_note: intentNote,
        knowledge_clarify_origin: "reply_to_customer",
      },
    });
    await sendAdminButtons({
      to: adminPhone,
      bodyText: "לשמור את השאלה והתשובה בבסיס הידע כדי שהבוט ידע לענות גם על ניסוחים דומים בעתיד?",
      buttons: [
        { id: "save_yes", title: "כן, שמור" },
        { id: "save_no", title: "לא, דלג" },
      ],
      intent: "save_confirm_prompt",
    });
    return;
  }

  if (session.state === ADMIN_REPLYING) {
    const customerPhone = session.collected_data?.customer_phone;
    if (!customerPhone) {
      await resetAdminSession(session.id);
      await sendAdminTextMessage(adminPhone, "אירעה שגיאה — לא נמצא מספר לקוח. נסה שוב.");
      return;
    }

    await sendTextMessage(customerPhone, text);

    const sessionId = `${customerPhone}_${restaurantId}`;
    await switchToBot(sessionId);

    await updateAdminSessionState(session.id, {
      state: ADMIN_KNOWLEDGE_INTENT_CLARIFY,
      collected_data: {
        ...session.collected_data,
        admin_answer: text,
        knowledge_clarify_origin: "reply_to_customer",
      },
    });

    await sendAdminTextMessage(adminPhone, "התשובה נשלחה ללקוח ✅");
    await sendAdminTextMessageRaw(
      adminPhone,
      "לפני שמירה: אם יש כוונה מיוחדת שנרצה שהבוט יבין גם בניסוחים אחרים, כתוב משפט קצר.\nאם אין צורך, כתוב 'דלג'."
    );
    return;
  }

  const replyMatch = text.match(/^ענה\s+(\d+)\s+(.+)$/s);
  if (replyMatch) {
    const customerPhone = replyMatch[1];
    const replyText = replyMatch[2].trim();

    await sendTextMessage(customerPhone, replyText);

    const sessionId = `${customerPhone}_${restaurantId}`;
    await switchToBot(sessionId);

    const pendingSnap = await db.collection("unanswered_questions")
      .where("restaurant_id", "==", restaurantId)
      .where("phone_number", "==", customerPhone)
      .where("status", "==", "PENDING")
      .orderBy("created_at", "desc")
      .limit(1)
      .get();
    const questionId = pendingSnap.empty ? null : pendingSnap.docs[0].id;
    const questionText = pendingSnap.empty ? "" : pendingSnap.docs[0].data().user_message;

    await updateAdminSessionState(session.id, {
      state: ADMIN_KNOWLEDGE_INTENT_CLARIFY,
      collected_data: {
        customer_phone: customerPhone,
        admin_answer: replyText,
        customer_question: questionText,
        question_id: questionId,
        knowledge_clarify_origin: "reply_to_customer",
      },
    });

    await sendAdminTextMessage(adminPhone, "התשובה נשלחה ללקוח ✅");
    await sendAdminTextMessageRaw(
      adminPhone,
      "לפני שמירה: אם יש כוונה מיוחדת שנרצה שהבוט יבין גם בניסוחים אחרים, כתוב משפט קצר.\nאם אין צורך, כתוב 'דלג'."
    );
    return;
  }

  if (session.state === ADMIN_EVENT_OPTIONAL) {
    if (isCancelText(trimmedText)) {
      await resetAdminSession(session.id);
      await sendAdminTextMessage(adminPhone, "בוטל. אפשר לשלוח עדכון חדש בכל רגע.");
      return;
    }

    const yesNo = normalizeYesNo(trimmedText);
    if (yesNo === "no") {
      const merged = {
        ...(session.collected_data || {}),
        event_optional_done: true,
      };
      const summary = buildConfirmSummaryText("add_event", merged);
      await updateAdminSessionState(session.id, {
        state: ADMIN_CONFIRMING,
        pending_action: "add_event",
        collected_data: merged,
        restaurant_id: restaurantId,
      });
      await sendAdminTextMessageRaw(adminPhone, summary);
      await pushAdminMessage(session.id, "assistant", summary);
      return;
    }

    if (yesNo === "yes") {
      await sendAdminTextMessage(
        adminPhone,
        "מעולה, כתוב את הפרטים שתרצה להוסיף (מחיר, האם נדרשת הזמנה מראש, ופרטים נוספים)."
      );
      return;
    }

    const parsedOptional = await parseAdminIntent(trimmedText, "add_event", session.collected_data || {});
    const merged = normalizeAdminParsedFields("add_event", {
      ...(session.collected_data || {}),
      ...(parsedOptional.fields || {}),
      event_optional_done: true,
    });
    const summary = buildConfirmSummaryText("add_event", merged);
    await updateAdminSessionState(session.id, {
      state: ADMIN_CONFIRMING,
      pending_action: "add_event",
      collected_data: merged,
      restaurant_id: restaurantId,
    });
    await sendAdminTextMessageRaw(adminPhone, summary);
    await pushAdminMessage(session.id, "assistant", summary);
    return;
  }

  if (session.state === ADMIN_EVENT_EDIT_SELECT) {
    const fieldKey = parseEventEditField(trimmedText);
    if (!fieldKey) {
      await sendAdminTextMessageRaw(adminPhone, eventEditListText(session.collected_data || {}));
      return;
    }
    const prompt = eventFieldAskText(fieldKey);
    await updateAdminSessionState(session.id, {
      state: ADMIN_EVENT_EDIT_ANSWER,
      pending_action: "add_event",
      collected_data: {
        ...(session.collected_data || {}),
        event_edit_key: fieldKey,
      },
      restaurant_id: restaurantId,
    });
    await sendAdminTextMessage(adminPhone, prompt);
    return;
  }

  if (session.state === ADMIN_EVENT_EDIT_ANSWER) {
    const editKey = session.collected_data?.event_edit_key;
    if (!editKey) {
      await updateAdminSessionState(session.id, {
        state: ADMIN_EVENT_EDIT_SELECT,
        pending_action: "add_event",
      });
      await sendAdminTextMessageRaw(adminPhone, eventEditListText(session.collected_data || {}));
      return;
    }
    const merged = { ...(session.collected_data || {}) };
    const nextValue = String(trimmedText || "").trim();
    if (!nextValue) {
      await sendAdminTextMessage(adminPhone, "לא קיבלתי ערך לעדכון. אפשר לכתוב שוב בקצרה.");
      return;
    }
    if (editKey === "reservation_required") {
      merged[editKey] = normalizeEventReservationValue(nextValue);
    } else if (editKey === "event_name") {
      merged[editKey] = sanitizeEventNameForAction(nextValue);
    } else if (editKey === "date") {
      merged[editKey] = normalizeEventDateForAction(nextValue);
    } else if (editKey === "time") {
      merged[editKey] = normalizeEventTimeForAction(nextValue);
    } else if (editKey === "ticket_price") {
      merged[editKey] = normalizeTicketPriceForAction(nextValue);
    } else if (editKey === "details") {
      merged[editKey] = normalizeNoValue(nextValue, "אין");
    } else {
      merged[editKey] = nextValue;
    }
    merged.event_edit_key = null;
    merged.event_optional_done = true;
    const summary = buildConfirmSummaryText("add_event", merged);
    await updateAdminSessionState(session.id, {
      state: ADMIN_CONFIRMING,
      pending_action: "add_event",
      collected_data: merged,
      restaurant_id: restaurantId,
    });
    await sendAdminTextMessageRaw(adminPhone, summary);
    await pushAdminMessage(session.id, "assistant", summary);
    return;
  }

  if (session.state === ADMIN_CONFIRMING) {
    if (session.pending_action === "add_event" && isEventEditIntent(trimmedText)) {
      await updateAdminSessionState(session.id, {
        state: ADMIN_EVENT_EDIT_SELECT,
        pending_action: "add_event",
        collected_data: {
          ...(session.collected_data || {}),
          event_edit_key: null,
        },
      });
      await sendAdminTextMessageRaw(adminPhone, eventEditListText(session.collected_data || {}));
      return;
    }
    const confirmation = normalizeYesNo(text);
    if (confirmation === "no") {
      await resetAdminSession(session.id);
      await sendAdminTextMessage(adminPhone, "בוטל. אפשר לשלוח עדכון חדש בכל רגע.");
      return;
    }
    if (confirmation === "yes") {
      if (session.pending_action === "add_custom") {
        const customContent = String(session.collected_data?.content || "");
        if (!canExtractCustomQuestionAnswer(customContent)) {
          await updateAdminSessionState(session.id, {
            state: ADMIN_KNOWLEDGE_INTENT_CLARIFY,
            pending_action: "add_custom",
            collected_data: {
              ...(session.collected_data || {}),
              knowledge_clarify_origin: "add_custom",
            },
            restaurant_id: restaurantId,
          });
          await sendAdminTextMessageRaw(
            adminPhone,
            "כדי למנוע חוסר הבנה: כתוב במשפט קצר למה בדיוק הכוונה של הפריט הזה ואיך לקוח עשוי לשאול את זה.\nאם אין צורך, כתוב 'דלג'."
          );
          return;
        }
      }
      const out = await saveKnowledgeAction(restaurantId, session.pending_action, session.collected_data || {});
      if (out && typeof out === "object" && out.savedContent) {
        await updateAdminSessionState(session.id, {
          last_added_knowledge_content: out.savedContent,
          last_added_at: Date.now(),
        });
      }
      await resetAdminSession(session.id);
      const msg = typeof out === "string" ? out : (out && out.message) || "נשמר בהצלחה.";
      await pushAdminMessage(session.id, "assistant", msg);
      await sendAdminTextMessageRaw(adminPhone, msg);
      return;
    }
    if (session.pending_action === "add_event") {
      await sendAdminTextMessage(adminPhone, "לאישור כתוב 'כן', לביטול כתוב 'לא', ולעריכה כתוב 'ערוך'.");
      return;
    }
    await sendAdminTextMessage(adminPhone, "לאישור כתוב 'כן', לביטול כתוב 'לא'.");
    return;
  }

  const parsed = await parseAdminIntent(
    text,
    session.state === ADMIN_COLLECTING ? session.pending_action : null,
    adminIntentContextData(session, session.state === ADMIN_COLLECTING ? session.collected_data || {} : {}),
    adminIntentRecentMessages(session)
  );

  if (parsed.action === "cancel") {
    await resetAdminSession(session.id);
    await sendAdminTextMessage(adminPhone, "הפעולה בוטלה.");
    return;
  }

  if (parsed.action === "continue_previous_list") {
    const listState = getActiveKnowledgeListState(session);
    if (!listState) {
      await sendAdminTextMessageRaw(
        adminPhone,
        "אין כרגע רשימה פתוחה להמשך. אם תרצה לראות את כל המידע ששמור, כתוב למשל: תראה לי את כל המידע."
      );
      return;
    }
    const page = await listKnowledgeItemsPage(
      restaurantId,
      Number(listState.next_offset || 0),
      Number(listState.page_size || KNOWLEDGE_LIST_PAGE_SIZE)
    );
    await updateAdminSessionState(session.id, {
      collected_data: {
        ...(session.collected_data || {}),
        knowledge_list_pagination: page.hasMore
          ? {
            next_offset: page.nextOffset,
            total: page.total,
            page_size: Number(listState.page_size || KNOWLEDGE_LIST_PAGE_SIZE),
            expires_at: Date.now() + KNOWLEDGE_LIST_CONTINUE_TTL_MS,
          }
          : null,
      },
    });
    await sendAdminTextMessageRaw(adminPhone, page.text);
    await pushAdminMessage(session.id, "assistant", page.text);
    return;
  }

  if (parsed.action === "get_knowledge_content") {
    const query = String(parsed.fields?.query || text || "").trim();
    const contentText = await getKnowledgeContentForManager(restaurantId, query, session);
    await sendAdminTextMessageRaw(adminPhone, contentText);
    await pushAdminMessage(session.id, "assistant", contentText);
    return;
  }

  if (parsed.action === "view_knowledge") {
    const page = await listKnowledgeItemsPage(restaurantId, 0);
    await updateAdminSessionState(session.id, {
      collected_data: {
        ...(session.collected_data || {}),
        knowledge_list_pagination: page.hasMore
          ? {
            next_offset: page.nextOffset,
            total: page.total,
            page_size: KNOWLEDGE_LIST_PAGE_SIZE,
            expires_at: Date.now() + KNOWLEDGE_LIST_CONTINUE_TTL_MS,
          }
          : null,
      },
    });
    await sendAdminTextMessageRaw(adminPhone, page.text);
    await pushAdminMessage(session.id, "assistant", page.text);
    return;
  }

  const knowledgeQueryHint = extractKnowledgeQueryFromManagerText(trimmedText);
  if (knowledgeQueryHint) {
    const contentText = await getKnowledgeContentForManager(restaurantId, knowledgeQueryHint, session);
    await sendAdminTextMessageRaw(adminPhone, contentText);
    await pushAdminMessage(session.id, "assistant", contentText);
    return;
  }

  const action = session.state === ADMIN_COLLECTING ? session.pending_action : parsed.action;
  if (!action || action === "unknown") {
    const fallback = [
      "לא בטוח שהבנתי את הבקשה.",
      "אפשר לכתוב למשל:",
      "- מה יש לי עכשיו?",
      "- הוסף אירוע ...",
      "- שנה שעות פתיחה ...",
      "- עדכן תפריט ...",
      "- מחק את המבצע ...",
    ].join("\n");
    const generalReply = await generateAdminGeneralReply({
      messageText: text,
      restaurantName: restaurant.name || "",
    });
    const reply = generalReply || fallback;
    await sendAdminTextMessage(adminPhone, reply);
    await pushAdminMessage(session.id, "assistant", reply);
    return;
  }

  const mergedData = {
    ...(session.state === ADMIN_COLLECTING ? session.collected_data || {} : {}),
    ...(parsed.fields || {}),
  };
  const normalizedMergedData = normalizeAdminParsedFields(action, mergedData);
  const missing = collectMissingFields(action, normalizedMergedData);

  if (missing.length > 0) {
    await updateAdminSessionState(session.id, {
      state: ADMIN_COLLECTING,
      pending_action: action,
      collected_data: normalizedMergedData,
      restaurant_id: restaurantId,
    });
    const question = formatMissingQuestions(action, missing);
    await sendAdminTextMessageRaw(adminPhone, question);
    await pushAdminMessage(session.id, "assistant", question);
    return;
  }

  if (action === "add_event" && !normalizedMergedData.event_optional_done) {
    await updateAdminSessionState(session.id, {
      state: ADMIN_EVENT_OPTIONAL,
      pending_action: action,
      collected_data: normalizedMergedData,
      restaurant_id: restaurantId,
    });
    const optionalPrompt = await composeAdminReply({
      intent: "add_event_optional_prompt",
      context: {
        action: "add_event",
      },
      hardFacts: {
        instruction:
          "יש עכשיו שם אירוע, תאריך ושעה. שאל אם רוצים להוסיף פרטים נוספים: מחיר, הזמנה מראש, או פרטים נוספים. אם אין, להציע לכתוב 'לא'.",
      },
      emergencyText: "יש עוד פרטים שתרצה להוסיף לאירוע? למשל מחיר, הזמנה מראש או פרטים נוספים. אם לא, כתוב 'לא'.",
    });
    await sendAdminTextMessageRaw(adminPhone, optionalPrompt);
    await pushAdminMessage(session.id, "assistant", optionalPrompt);
    return;
  }

  const summary = buildConfirmSummaryText(action, normalizedMergedData);
  await updateAdminSessionState(session.id, {
    state: ADMIN_CONFIRMING,
    pending_action: action,
    collected_data: normalizedMergedData,
    restaurant_id: restaurantId,
  });
  await sendAdminTextMessageRaw(adminPhone, summary);
  await pushAdminMessage(session.id, "assistant", summary);
}

async function safeProcessAdminMessage({ adminPhone, text }) {
  try {
    await processAdminMessage({ adminPhone, text });
  } catch (error) {
    logger.error("Admin bot processing failed", { error: error.message, adminPhone });
    try {
      await sendAdminTextMessage(adminPhone, "אירעה שגיאה בעדכון. נסה שוב בעוד רגע.");
    } catch (_notifyError) {
      // Avoid masking the original failure when outbound admin messaging is unavailable.
    }
  }
}

module.exports = {
  safeProcessAdminMessage,
  __test__: {
    formatKnowledgeItemForManager,
    buildKnowledgeListPage,
    isKnowledgeListContinueText,
    getActiveKnowledgeListState,
    adminIntentRecentMessages,
    adminIntentContextData,
  },
};
