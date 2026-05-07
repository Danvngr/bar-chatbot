const customBank = require("../config/onboardingQuestionBank.custom");

const STYLE_CAFE = "cafe";
const STYLE_RESTAURANT = "restaurant";
const STYLE_BAR = "bar";

const DEFAULT_BASE_QUESTIONS = [
  { key: "venue_style", topic: "סוג העסק (בר / מסעדה / בית קפה / אחר)" },
  { key: "name", topic: "שם העסק" },
  { key: "phone_number", topic: "מספר טלפון לפניות לקוחות" },
];

const TOPIC_QUESTIONS = [
  { key: "hours", topic: "שעות פתיחה וסגירת מטבח", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "holiday_hours", topic: "שעות פתיחה בחגים", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "address", topic: "כתובת ומיקום מדויק", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "navigation_link", topic: "קישור לניווט (Waze/Google Maps)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "parking_enabled", topic: "יש חניה נוחה ללקוחות? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "parking",
    topic: "פרטי חניה (צמודה/חניונים/כחול-לבן)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "parking_enabled",
  },
  { key: "accessibility_enabled", topic: "יש נגישות לנכים ולעגלות? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "accessibility",
    topic: "פרטי נגישות לנכים ולעגלות",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "accessibility_enabled",
  },
  { key: "seating_areas", topic: "אזורי ישיבה (בחוץ/בפנים/VIP)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "seating_climate", topic: "תנאי ישיבה ומיזוג (חימום/קירור/קירוי)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "baby_changing", topic: "פינת החתלה בשירותים", askFor: [STYLE_CAFE, STYLE_RESTAURANT] },
  { key: "medical_kit", topic: "ציוד רפואי (עזרה ראשונה, ציוד לאלרגנים)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "kosher_enabled", topic: "האם יש כשרות? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "kosher",
    topic: "סוג הכשרות",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "kosher_enabled",
  },
  { key: "wifi_enabled", topic: "יש Wi‑Fi ללקוחות? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "wifi",
    topic: "פרטי Wi‑Fi (סיסמה/גישה)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "wifi_enabled",
  },
  { key: "menu_main", topic: "תפריט אוכל עיקרי (קישור או פירוט קצר)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "has_dessert_menu",
    topic: "האם יש תפריט קינוחים נפרד? (כן/לא)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
  },
  {
    key: "menu_dessert",
    topic: "תפריט קינוחים (קישור או פירוט קצר)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "has_dessert_menu",
  },
  { key: "kids_menu_enabled", topic: "יש תפריט ילדים? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT] },
  {
    key: "kids_menu",
    topic: "תפריט ילדים ומנות לקטנים",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT],
    requires_yes_key: "kids_menu_enabled",
  },
  { key: "alcohol_menu_enabled", topic: "יש תפריט אלכוהול נפרד מהתפריט הראשי? (כן/לא)", askFor: [STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "alcohol_menu",
    topic: "תפריט אלכוהול (בירות/יין/קוקטיילים)",
    askFor: [STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "alcohol_menu_enabled",
  },
  { key: "business_lunch_brunch", topic: "עסקיות צהריים / בראנץ'", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "vegan_vegetarian", topic: "מנות טבעוניות / צמחוניות", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "gluten_free", topic: "ללא גלוטן (וסטריליות מטבח)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "allergy_info", topic: "רשימת אלרגנים מרכזיים שחשוב לציין ללקוחות", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "allergy_process",
    topic: "נוהל מענה על אלרגיות (מה בודקים מול מטבח ומה אסור להבטיח)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
  },
  {
    key: "cross_contact_policy",
    topic: "מניעת זיהום משני (cross-contact) והנוסח המדויק ללקוח",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
  },
  {
    key: "medical_diet_info",
    topic: "רגישויות ותזונה רפואית (צליאק/סוכרת/לקטוז וכדומה)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
  },
  { key: "milk_types", topic: "סוגי חלב (סויה/שיבולת/שקדים/דל לקטוז)", askFor: [STYLE_CAFE, STYLE_RESTAURANT] },
  { key: "deliveries_enabled", topic: "האם יש משלוחים? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "deliveries_details",
    topic: "פרטי משלוחים (פלטפורמות, אזורי חלוקה, שעות)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "deliveries_enabled",
  },
  {
    key: "deliveries_tracking",
    topic: "איך הלקוחות עוקבים אחרי משלוח?",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "deliveries_enabled",
  },
  { key: "reservation_enabled", topic: "האם ניתן להזמין שולחן מראש? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "reservation",
    topic: "הזמנת שולחן (קישור חיצוני/טלפון)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "reservation_enabled",
  },
  {
    key: "large_group_reservation",
    topic: "הזמנת קבוצה גדולה (מעל כמות מסוימת)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "reservation_enabled",
  },
  {
    key: "cancellation_fee",
    topic: "דמי ביטול / מינימום הזמנה לסועד",
    askFor: [STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "reservation_enabled",
  },
  {
    key: "reservation_deposit",
    topic: "אשראי פיקדון להזמנות",
    askFor: [STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "reservation_enabled",
  },
  { key: "payment", topic: "Apple Pay / Google Pay / אשראי", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "cibus_10bis", topic: "סיבוס / תן ביס (שעות וימים)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "promotions", topic: "מבצעים קבועים", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "happy_hour", topic: "האפי האוור (Happy Hour)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "customer_club_enabled", topic: "יש מועדון לקוחות? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "customer_club",
    topic: "פרטי מועדון לקוחות",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "customer_club_enabled",
  },
  { key: "discounts", topic: "הנחות (מילואים/סטודנטים/כוחות ביטחון)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "birthday_benefits", topic: "הטבות יום הולדת / יום נישואין", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "specials", topic: "ספיישלים (יום מסוים/חגים/תקופה)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "gift_cards_enabled", topic: "אפשר לשלם בגיפט קארד / BuyMe? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "gift_cards",
    topic: "פרטי גיפט קארד / BuyMe / שוברים",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "gift_cards_enabled",
  },
  { key: "inhouse_events_enabled", topic: "יש אצלכם אירועי תוכן/קונספט קבועים במקום? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "inhouse_events",
    topic: "אירועי תוכן בעסק (טריוויה/סטנדאפ/ערבי קונספט וכדומה)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "inhouse_events_enabled",
  },
  {
    key: "inhouse_events_entry_fee",
    topic: "האם יש תשלום כניסה בחלק מהאירועים? (כן/לא + פירוט קצר אם כן)",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "inhouse_events_enabled",
  },
  {
    key: "inhouse_events_guidelines",
    topic: "יש נהלים מיוחדים לאירועים (למשל הזמנה מראש/פתיחת שערים/משך אירוע)?",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "inhouse_events_enabled",
  },
  { key: "private_events_enabled", topic: "אפשר לקיים אצלכם אירועים פרטיים? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "private_events",
    topic: "אירועים פרטיים / חדר VIP / סגירת מקום",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "private_events_enabled",
  },
  { key: "sports_broadcasts_enabled", topic: "האם אתם משדרים שידורי ספורט במקום? (כן/לא)", askFor: [STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "sports_broadcasts",
    topic: "אילו שידורי ספורט יש בדרך כלל (ליגות/משחקים/ימים)?",
    askFor: [STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "sports_broadcasts_enabled",
  },
  { key: "music_enabled", topic: "יש אצלכם מוזיקה קבועה או DJ? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "music_style",
    topic: "איזה סגנון מוזיקה יש אצלכם ובאילו ימים/שעות?",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "music_enabled",
  },
  { key: "age_restriction", topic: "האם יש הגבלת גיל לכניסה למקום?", askFor: [STYLE_RESTAURANT, STYLE_BAR] },
  { key: "smoking_policy", topic: "מדיניות עישון (מותר או לא או אזור ייעודי?)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "dress_code", topic: "האם יש קוד לבוש בכניסה?", askFor: [STYLE_RESTAURANT, STYLE_BAR] },
  { key: "chaser_deals", topic: "מבצעי צ'ייסרים / דילים / בקבוקים לשולחן", askFor: [STYLE_BAR] },
  { key: "corkage_fee", topic: "דמי חליצה", askFor: [STYLE_RESTAURANT, STYLE_BAR] },
  { key: "merchandise_enabled", topic: "האם אתם מציעים מרצ'נדייז ללקוחות? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "merchandise",
    topic: "איזה מרצ'נדייז יש לכם?",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "merchandise_enabled",
  },
  { key: "lost_found_enabled", topic: "יש נוהל אבדות ומציאות בעסק? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "lost_found",
    topic: "איך מתנהל טיפול בחפצים שנשכחו?",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "lost_found_enabled",
  },
  { key: "security_enabled", topic: "יש אבטחה או מצלמות שכדאי לציין ללקוחות? (כן/לא)", askFor: [STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "security",
    topic: "מה חשוב לדעת לגבי אבטחה במקום?",
    askFor: [STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "security_enabled",
  },
  { key: "hiring_enabled", topic: "האם אתם מגייסים עובדים כרגע? (כן/לא)", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  {
    key: "hiring",
    topic: "לאילו תפקידים אתם מגייסים ואיך פונים?",
    askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR],
    requires_yes_key: "hiring_enabled",
  },
  { key: "human_representative", topic: "דיבור עם נציג אנושי", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
  { key: "receipt_feedback", topic: "בקשת העתק קבלה / משוב ותלונות", askFor: [STYLE_CAFE, STYLE_RESTAURANT, STYLE_BAR] },
];

const SYSTEM_CLOSING_QUESTIONS = [
  {
    key: "manager_code",
    topic: "קוד מנהל מאובטח (לפחות 8 תווים, אות גדולה, אות קטנה, מספר וסימן מיוחד)",
  },
  {
    key: "extra",
    topic: "מידע נוסף חשוב שתרצה שהבוט ידע (אם אין, אפשר לכתוב: אין)",
  },
];

function cleanValue(value) {
  return String(value || "").trim();
}

function mergeQuestions(baseQuestions, extraQuestions) {
  const merged = [...(baseQuestions || [])];
  const existingKeys = new Set(merged.map((q) => q.key));
  (extraQuestions || []).forEach((q) => {
    if (!q || !q.key) return;
    if (existingKeys.has(q.key)) return;
    merged.push({
      key: q.key,
      topic: q.topic || q.text || q.key,
      text: q.text || q.topic || q.key,
      askFor: Array.isArray(q.askFor) ? q.askFor : undefined,
      requires_yes_key: q.requires_yes_key || undefined,
    });
    existingKeys.add(q.key);
  });
  return merged;
}

function resolveBaseQuestions() {
  return mergeQuestions(DEFAULT_BASE_QUESTIONS, customBank.baseQuestions || []);
}

function resolveTopicQuestions() {
  return mergeQuestions(TOPIC_QUESTIONS, customBank.topicQuestions || []);
}

function classifyVenueStyle(value) {
  const v = cleanValue(value).toLowerCase();
  if (!v) return null;
  if (v.includes("בר") || v.includes("פאב") || v.includes("club")) return "bar";
  if (v.includes("קפה") || v.includes("בית קפה") || v.includes("cafe")) return "cafe";
  if (v.includes("מסעד") || v.includes("restaurant")) return "restaurant";
  return null;
}

function getStyleTopics(collectedData = {}) {
  const style = classifyVenueStyle(collectedData.venue_style);
  const allTopics = resolveTopicQuestions();
  if (!style) return [];
  return allTopics.filter((q) => Array.isArray(q.askFor) && q.askFor.includes(style));
}

function normalizeYesNo(v) {
  const value = cleanValue(v).toLowerCase();
  if (!value) return "";
  if (["כן", "yes", "y", "true", "יש"].includes(value)) return "yes";
  if (["לא", "no", "n", "false", "אין"].includes(value)) return "no";
  return "";
}

function isQuestionRelevant(q, collectedData = {}) {
  if (!q) return false;
  if (!q.requires_yes_key) return true;
  return normalizeYesNo(collectedData[q.requires_yes_key]) === "yes";
}

function getOnboardingQuestionPlan(collectedData = {}) {
  const base = resolveBaseQuestions();
  const styled = getStyleTopics(collectedData).filter((q) => isQuestionRelevant(q, collectedData));
  return [...base, ...styled, ...SYSTEM_CLOSING_QUESTIONS];
}

function getQuestionByKey(key, collectedData = {}) {
  return getOnboardingQuestionPlan(collectedData).find((q) => q.key === key) || null;
}

function getSkippedKeys(collectedData = {}) {
  const raw = Array.isArray(collectedData.skipped_question_keys) ? collectedData.skipped_question_keys : [];
  return new Set(raw);
}

function toSlug(text) {
  const fallback = `restaurant_${Date.now()}`;
  const normalized = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return normalized || fallback;
}

function normalizeOptional(value) {
  const v = cleanValue(value).toLowerCase();
  if (!v || v === "אין" || v === "none" || v === "-" || v === "לא רלוונטי") {
    return "";
  }
  return cleanValue(value);
}

function getNextQuestion(collectedData = {}) {
  const skipped = getSkippedKeys(collectedData);
  const next = getOnboardingQuestionPlan(collectedData).find((q) => !skipped.has(q.key) && !cleanValue(collectedData[q.key]));
  return next ? (next.topic || next.text || next.key) : null;
}

function isComplete(collectedData = {}) {
  return !getNextQuestion(collectedData);
}

function buildOnboardingSummary(collectedData = {}) {
  const managerCode = cleanValue(collectedData.manager_code);
  const visibleManagerCode = managerCode || "לא צוין";
  const plan = getOnboardingQuestionPlan(collectedData);
  const skipped = Array.from(getSkippedKeys(collectedData));
  const skippedRows = skipped
    .map((key) => getQuestionByKey(key, collectedData))
    .filter(Boolean)
    .map((q) => `- ${q.topic || q.key}`);
  const rows = plan
    .map((q) => {
      if (q.key === "manager_code") return null;
      const val = cleanValue(collectedData[q.key]);
      return val ? `• *${q.topic || q.key}:* ${val}` : null;
    })
    .filter(Boolean);

  return [
    "*סיכום ההקמה:*",
    ...(rows.length > 0 ? rows : []),
    `• *קוד מנהל:* ${visibleManagerCode}`,
    ...(skippedRows.length > 0 ? ["*שאלות שדולגו:*", ...skippedRows.map((row) => row.replace(/^- /, "• "))] : []),
    "",
    "*לאשר הקמה?* (כן=מאשר, לא=שינוי סעיפים)",
  ].join("\n");
}

function buildKnowledgeBase(collectedData = {}) {
  const categoryByKey = {
    hours: "hours",
    holiday_hours: "hours",
    kosher_enabled: "kosher",
    kosher: "kosher",
    address: "address",
    navigation_link: "address",
    wifi_enabled: "custom",
    wifi: "custom",
    parking_enabled: "custom",
    parking: "custom",
    accessibility_enabled: "custom",
    accessibility: "custom",
    menu_main: "menu",
    sports_broadcasts_enabled: "custom",
    music_enabled: "custom",
    customer_club_enabled: "custom",
    customer_club: "custom",
    merchandise_enabled: "custom",
    lost_found_enabled: "custom",
    security_enabled: "custom",
    hiring_enabled: "custom",
    gift_cards_enabled: "custom",
    gift_cards: "custom",
    inhouse_events_enabled: "custom",
    inhouse_events: "custom",
    inhouse_events_entry_fee: "custom",
    inhouse_events_guidelines: "custom",
    private_events_enabled: "custom",
    private_events: "custom",
    menu_dessert: "menu",
    has_dessert_menu: "menu",
    kids_menu_enabled: "menu",
    kids_menu: "menu",
    alcohol_menu_enabled: "menu",
    alcohol_menu: "menu",
    deliveries_enabled: "reservation",
    deliveries_details: "reservation",
    deliveries_tracking: "reservation",
    reservation_enabled: "reservation",
    reservation: "reservation",
    large_group_reservation: "reservation",
    payment: "payment",
    allergy_process: "custom",
    cross_contact_policy: "custom",
    medical_diet_info: "custom",
  };

  const plan = getOnboardingQuestionPlan(collectedData);
  const kb = [];
  plan.forEach((q) => {
    if (q.key === "manager_code") return;
    const val = normalizeOptional(collectedData[q.key]);
    if (!val) return;
    kb.push({
      category: categoryByKey[q.key] || "custom",
      content: `${q.topic || q.key}: ${val}`,
    });
  });
  return kb;
}

function buildProvisionPayload({ collectedData, adminPhone, inviteCode }) {
  const name = cleanValue(collectedData.name);
  const restaurantId = `${toSlug(name)}_${String(inviteCode || "new").toLowerCase()}`;
  const whatsappPhoneNumberId = cleanValue(collectedData.whatsapp_phone_number_id);
  const venueStyleRaw = cleanValue(collectedData.venue_style);
  const venueStyleKey = classifyVenueStyle(venueStyleRaw);
  const businessType = venueStyleKey === "bar"
    ? "בר"
    : (venueStyleKey === "cafe" ? "בית קפה" : (venueStyleRaw || "מסעדה"));
  return {
    restaurant_id: restaurantId,
    name,
    venue_style: businessType,
    business_type: businessType,
    phone_number: cleanValue(collectedData.phone_number),
    admin_phone: cleanValue(adminPhone),
    whatsapp_phone_number_id: whatsappPhoneNumberId || "",
    telegram_recipients: [],
    system_prompt_base: `אתה נציג שירות של ${name}. סוג העסק הוא ${businessType}. תענה בעברית, בקצרה ובחום. השתמש רק במידע שבמאגר. אם אין תשובה, החזר TRANSFER_TO_HUMAN.`,
    knowledge_base: buildKnowledgeBase(collectedData),
  };
}

module.exports = {
  QUESTIONS: DEFAULT_BASE_QUESTIONS,
  BASE_QUESTIONS: DEFAULT_BASE_QUESTIONS,
  TOPIC_QUESTIONS,
  SYSTEM_CLOSING_QUESTIONS,
  resolveBaseQuestions,
  resolveTopicQuestions,
  getOnboardingQuestionPlan,
  getQuestionByKey,
  getNextQuestion,
  isComplete,
  buildOnboardingSummary,
  buildKnowledgeBase,
  buildProvisionPayload,
};
