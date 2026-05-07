const env = require("../config/env");
const { chatCompletion } = require("./openai");

function extractJson(text) {
  const clean = String(text || "").trim();
  try {
    return JSON.parse(clean);
  } catch (_err) {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch (_err2) {
      return null;
    }
  }
}

function fieldMeaning(fieldKey) {
  const map = {
    name: "שם העסק",
    address: "כתובת מלאה",
    phone_number: "טלפון שירות/פניות",
    hours: "שעות פתיחה",
    holiday_hours: "שעות פתיחה בחגים",
    navigation_link: "קישור ניווט",
    parking_enabled: "האם יש חניה נוחה ללקוחות",
    parking: "סידור חניה ללקוחות",
    seating_areas: "אזורי ישיבה",
    seating_climate: "ישיבה בחוץ/בפנים ומיזוג",
    accessibility_enabled: "האם יש נגישות לנכים ולעגלות",
    accessibility: "נגישות",
    wifi_enabled: "האם יש Wi-Fi",
    wifi: "Wi-Fi וסיסמה אם יש",
    kosher_enabled: "האם יש כשרות",
    kosher: "כשרות",
    menu_link: "קישור לתפריט",
    menu_main: "תפריט אוכל עיקרי",
    has_dessert_menu: "האם יש קינוחים נפרדים",
    menu_dessert: "תפריט קינוחים",
    kids_menu_enabled: "האם יש תפריט ילדים",
    kids_menu: "תפריט ילדים",
    alcohol_menu_enabled: "האם יש תפריט אלכוהול",
    alcohol_menu: "תפריט אלכוהול",
    customer_club_enabled: "האם יש מועדון לקוחות",
    customer_club: "פרטי מועדון לקוחות",
    gift_cards_enabled: "האם יש גיפט קארד / BuyMe",
    gift_cards: "פרטי שוברים וגיפט קארד",
    inhouse_events_enabled: "האם יש אירועים קבועים במקום",
    private_events_enabled: "האם אפשר אירועים פרטיים",
    inhouse_events_entry_fee: "תשלום כניסה לאירועים במקום",
    inhouse_events_guidelines: "הנחיות מיוחדות לאירועים במקום",
    sports_broadcasts_enabled: "האם יש שידורי ספורט במקום",
    music_enabled: "האם יש מוזיקה קבועה / DJ",
    music_style: "סגנון מוזיקה ותוכנית מוזיקלית",
    merchandise_enabled: "האם יש מרצ'נדייז ללקוחות",
    merchandise: "פרטי מרצ'נדייז ללקוחות",
    lost_found_enabled: "האם יש נוהל אבדות ומציאות",
    lost_found: "נוהל אבדות ומציאות",
    security_enabled: "האם יש אבטחה או מצלמות",
    security: "אבטחה ומצלמות במקום",
    hiring_enabled: "האם מגייסים עובדים",
    hiring: "גיוס עובדים ותפקידים פתוחים",
    allergy_process: "נוהל מענה לפניות על אלרגיות",
    cross_contact_policy: "מדיניות זיהום משני (cross-contact)",
    medical_diet_info: "מידע על רגישויות ותזונה רפואית",
    human_representative: "מעבר לנציג אנושי",
    receipt_feedback: "העתק קבלה, משוב ותלונות",
    deliveries_enabled: "האם יש משלוחים",
    deliveries_details: "פרטי משלוחים",
    deliveries_tracking: "מעקב משלוחים ללקוח",
    reservation_enabled: "האם ניתן להזמין שולחן",
    reservation: "פרטי הזמנת מקום",
    payment: "אמצעי תשלום",
    extra: "מידע נוסף חשוב",
  };
  return map[fieldKey] || fieldKey;
}

function fallbackQuestionByTopic(topic) {
  const t = String(topic || "").trim();
  if (!t) return "אפשר לענות בקצרה על הנושא הזה?";
  if (t.includes("קוד מנהל")) {
    return "בחר קוד מנהל מאובטח (8+ תווים, אות גדולה, אות קטנה, מספר וסימן מיוחד).";
  }
  return `אשמח שתשתף בקצרה לגבי ${t}.`;
}

function normalizeLooseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/["'`״׳]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countDigits(value) {
  return (String(value || "").match(/\d/g) || []).length;
}

function looksLikeUrl(value) {
  const v = String(value || "").trim();
  return /^https?:\/\/\S+/i.test(v) || /^www\./i.test(v);
}

function normalizeDaysText(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  const normalized = normalizeLooseText(raw);
  if (normalized.includes("ימי חול") || normalized.includes("יום חול")) {
    return "ראשון-חמישי";
  }
  return raw
    .replace(/\bא[׳'"]?\s*-\s*ה[׳'"]?\b/g, "ראשון-חמישי")
    .replace(/\bא[׳'"]?\s*-\s*ו[׳'"]?\b/g, "ראשון-שישי")
    .replace(/\bיום\s*א(?:׳|')?|\bא(?:׳|')\b/g, "ראשון")
    .replace(/\bיום\s*ב(?:׳|')?|\bב(?:׳|')\b/g, "שני")
    .replace(/\bיום\s*ג(?:׳|')?|\bג(?:׳|')\b/g, "שלישי")
    .replace(/\bיום\s*ד(?:׳|')?|\bד(?:׳|')\b/g, "רביעי")
    .replace(/\bיום\s*ה(?:׳|')?|\bה(?:׳|')\b/g, "חמישי")
    .replace(/\bיום\s*ו(?:׳|')?|\bו(?:׳|')\b/g, "שישי")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHoursText(value) {
  const raw = normalizeDaysText(value);
  return String(raw || "")
    .replace(/(\d{1,2})\.(\d{2})/g, "$1:$2")
    .replace(/(\d{1,2})\s*עד\s*(\d{1,2})(?!:)/g, (_, a, b) => `${a}:00-${b}:00`)
    .replace(/(\d{1,2}):(\d{2})\s*עד\s*(\d{1,2}):(\d{2})/g, "$1:$2-$3:$4");
}

function normalizeNoValue(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeLooseText(raw);
  if (!raw || ["אין", "לא", "none", "-", "n/a", "בלי", "לא רלוונטי", "לא צוין"].includes(normalized)) {
    return "אין";
  }
  return raw;
}

function normalizeBooleanChoice(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeLooseText(raw);
  if (["כן", "yes", "y", "true", "יש"].includes(normalized)) return "כן";
  if (["לא", "no", "n", "false", "אין"].includes(normalized)) return "לא";
  return raw;
}

function isBooleanFieldKey(fieldKey) {
  return [
    "deliveries_enabled",
    "reservation_enabled",
    "has_dessert_menu",
    "kosher_enabled",
    "customer_club_enabled",
    "gift_cards_enabled",
    "inhouse_events_enabled",
    "private_events_enabled",
    "sports_broadcasts_enabled",
    "music_enabled",
    "merchandise_enabled",
    "lost_found_enabled",
    "security_enabled",
    "hiring_enabled",
    "parking_enabled",
    "accessibility_enabled",
    "wifi_enabled",
    "kids_menu_enabled",
    "alcohol_menu_enabled",
  ].includes(fieldKey);
}

function isDirectReservationValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (normalizeNoValue(raw) === "אין") return true;
  if (looksLikeUrl(raw)) return true;
  if (countDigits(raw) >= 9) return true;
  return false;
}

function isReferenceToPreviousAnswer(value) {
  const normalized = normalizeLooseText(value);
  if (!normalized) return false;
  return /(שלחתי|כבר שלחתי|שלחתי כבר|שלחתי לך|שלחתי לך כבר|שלחתי קודם|כמו שכתבתי|כמו למעלה|למעלה|בהודעה הקודמת|בהודעה למעלה|כמו מקודם|אותו קישור|אותו מספר)/.test(normalized);
}

function extractReferenceCandidate(fieldKey, recentMessages = []) {
  const userTexts = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((m) => String(m?.role || "") === "user")
    .map((m) => String(m?.content || "").trim())
    .filter(Boolean)
    .slice(-10)
    .reverse();

  if (fieldKey === "reservation") {
    for (const t of userTexts) {
      if (looksLikeUrl(t) || countDigits(t) >= 9) return t;
    }
  }
  if (fieldKey === "deliveries_details" || fieldKey === "deliveries_tracking") {
    for (const t of userTexts) {
      if (looksLikeUrl(t) || /(וולט|wolt|תן ביס|10bis|סיבוס|שליח|מעקב)/i.test(t)) return t;
    }
  }
  if (fieldKey === "menu_main" || fieldKey === "menu_dessert") {
    for (const t of userTexts) {
      if (looksLikeUrl(t) || /תפריט|מנות|קינוח/i.test(t)) return t;
    }
  }
  return "";
}

function normalizeVenueStyle(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeLooseText(raw);
  if (!normalized) return raw;
  if (normalized.includes("בית קפה") || normalized.includes("קפה")) return "בית קפה";
  if (normalized.includes("בר")) return "בר";
  if (normalized.includes("מסעד")) return "מסעדה";
  return raw;
}

function normalizeKosherText(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeLooseText(raw);
  if (!normalized) return raw;
  if (/(אין כשרות|לא כשר|ללא כשרות)/.test(normalized)) return "אין כשרות";
  if (/(רבנות|עיריית|עיריה|מועצה|מקומית|בדצ|בד״צ|בדץ)/.test(normalized)) {
    return raw.replace(/^\s*כשרות\s+/u, "רבנות ").trim();
  }
  if (/(מהדרין|בדצ|בד״צ|בדץ)/.test(normalized)) return "כשר למהדרין";
  if (/(רבנות|כשר)/.test(normalized)) return "כשר";
  return raw;
}

function fieldSpecificNormalizationHint(fieldKey) {
  if (fieldKey === "kosher") {
    return "אם צוין גוף משגיח או עיר/מועצה, שמור אותו במדויק. לדוגמה: 'רבנות מקומית'.";
  }
  if (fieldKey === "receipt_feedback") {
    return "נסח כתשובה ברורה ללקוח: איך מקבלים העתק קבלה, איך משאירים משוב ואיך פונים במקרה של תלונה.";
  }
  if (fieldKey === "human_representative") {
    return "נסח כתשובה ברורה ללקוח איך מגיעים לנציג אנושי.";
  }
  if (["lost_found", "security", "hiring", "allergy_process", "cross_contact_policy", "medical_diet_info"].includes(fieldKey)) {
    return "נסח כתשובת שירות ברורה וקצרה ללקוח, לא כפתק פנימי.";
  }
  if (fieldKey === "discounts") {
    return "נסח חד-משמעית מי זכאי להנחה ומי לא (למשל: חיילים כן, סטודנטים לא).";
  }
  if (fieldKey === "alcohol_menu") {
    return "אם אין תפריט אלכוהול נפרד, נסח במפורש שהוא חלק מהתפריט הראשי.";
  }
  return "";
}

function normalizePhoneText(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  if (digits.startsWith("972") && digits.length >= 11) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith("5") && digits.length === 9) {
    return `0${digits}`;
  }
  if (/^[2-9]\d{7,8}$/.test(digits)) {
    return `0${digits}`;
  }
  return digits;
}

function normalizeCustomerFacingText(fieldKey, value) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  if (!raw) return raw;
  const normalized = normalizeLooseText(raw);

  if (fieldKey === "receipt_feedback" && /(כל פניה|כל פנייה).*(בהתאם|מטופל|מטופלת)/.test(normalized)) {
    return "לבקשת העתק קבלה, משוב או תלונה אפשר לפנות אליי, ואני אדאג שהפנייה תטופל בהתאם.";
  }
  if (fieldKey === "human_representative" && /^אפשר\b/.test(normalized)) {
    return "אפשר לפנות אליי, ואם צריך אעביר לנציג אנושי.";
  }
  if (fieldKey === "discounts" && /רק.*חייל|לחיילים בלבד|חיילים בלבד/.test(normalized) && !/סטודנט/.test(normalized)) {
    return "יש הנחה לחיילים בלבד. אין הנחת סטודנטים.";
  }

  return raw;
}

function applyFieldContextAdjustments(fieldKey, value, collectedData = {}) {
  const raw = String(value || "").trim();
  if (!raw) return raw;

  if (fieldKey === "alcohol_menu") {
    const normalized = normalizeLooseText(raw);
    const noSeparateAlcoholMenu = /(אין|לא).*(נפרד|תפריט נפרד)|בלי תפריט נפרד/.test(normalized);
    if (noSeparateAlcoholMenu) {
      const menuMain = String(collectedData.menu_main || "").trim();
      if (menuMain) {
        return `אין תפריט אלכוהול נפרד; האלכוהול מופיע בתפריט הראשי: ${menuMain}`;
      }
      return "אין תפריט אלכוהול נפרד; האלכוהול מופיע בתפריט הראשי.";
    }
  }

  return raw;
}

function postProcessNormalizedAnswer(fieldKey, value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  if (fieldKey === "hours") return normalizeHoursText(raw);
  if (fieldKey === "phone_number") return normalizePhoneText(raw);
  if (fieldKey === "venue_style") return normalizeVenueStyle(raw);
  if (fieldKey === "kosher") return normalizeKosherText(raw);
  if ([
    "receipt_feedback",
    "human_representative",
    "lost_found",
    "security",
    "hiring",
    "allergy_process",
    "cross_contact_policy",
    "medical_diet_info",
  ].includes(fieldKey)) {
    return normalizeCustomerFacingText(fieldKey, raw);
  }
  if (isBooleanFieldKey(fieldKey)) {
    return normalizeBooleanChoice(raw);
  }
  if (["menu_link", "reservation", "extra"].includes(fieldKey)) return normalizeNoValue(raw);
  return raw;
}

async function normalizeOnboardingAnswer({ fieldKey, rawAnswer, collectedData = {}, recentMessages = [] }) {
  const answer = String(rawAnswer || "").trim();
  if (fieldKey === "manager_code") {
    return {
      normalizedAnswer: answer,
      needsClarification: false,
      clarificationQuestion: "",
      note: "",
    };
  }
  if (isBooleanFieldKey(fieldKey)) {
    const directBooleanAnswer = normalizeBooleanChoice(answer);
    if (directBooleanAnswer === "כן" || directBooleanAnswer === "לא") {
      return {
        normalizedAnswer: directBooleanAnswer,
        needsClarification: false,
        clarificationQuestion: "",
        note: "direct_boolean_answer",
      };
    }
  }
  if (fieldKey === "reservation" && isDirectReservationValue(answer)) {
    return {
      normalizedAnswer: postProcessNormalizedAnswer(fieldKey, answer),
      needsClarification: false,
      clarificationQuestion: "",
      note: "direct_reservation_answer",
    };
  }
  if (!answer) {
    return {
      normalizedAnswer: "",
      needsClarification: true,
      clarificationQuestion: "לא קיבלתי תשובה. אפשר לנסח שוב בקצרה?",
      note: "",
    };
  }

  if (isReferenceToPreviousAnswer(answer)) {
    const candidate = extractReferenceCandidate(fieldKey, recentMessages);
    if (candidate) {
      return {
        normalizedAnswer: postProcessNormalizedAnswer(fieldKey, candidate),
        needsClarification: false,
        clarificationQuestion: "",
        note: "resolved_from_recent_messages",
      };
    }
  }

  const prompt = [
    {
      role: "system",
      content: [
        "אתה מנרמל תשובות הקמה לבוט מסעדות.",
        "המטרה: להפוך תשובת בעל עסק לנוסח ברור, טבעי, וקל להבנה לבוט שירות לקוחות.",
        "החזר JSON בלבד, בלי טקסט נוסף.",
        "פורמט JSON:",
        "{",
        '  "normalized_answer": "string",',
        '  "needs_clarification": true/false,',
        '  "clarification_question": "string",',
        '  "note": "string"',
        "}",
        "כללים:",
        "1) עברית תקינה, קצרה וברורה.",
        "2) שעות פתיחה: נסה לפרוס ימים בצורה ברורה אם אפשר להבין מהכוונה, ולהרחיב קיצורים כמו א-ה לשמות ימים מלאים.",
        '3) אם התשובה לא ברורה מספיק - needs_clarification=true ושאלת הבהרה קצרה ב-"clarification_question".',
        '4) אם אין צורך בהבהרה - needs_clarification=false ו-"clarification_question" יהיה מחרוזת ריקה.',
        '5) אם המשתמש כתב שאין מידע (אין/לא/none וכדומה) שמור זאת בצורה ברורה.',
        "6) טלפון: אם ניתן להבין את המספר, החזר ספרות בלבד.",
        "7) סגנון מקום: אם אפשר, נרמל לקטגוריה ברורה (בר/מסעדה/בית קפה/אחר).",
        "8) כשרות: נסח באופן עקבי (למשל אין כשרות / כשר / כשר למהדרין).",
        "9) שדות שירות ומדיניות צריכים להישמע כמו תשובה ברורה ללקוח, לא כמו טיוטה פנימית.",
        "10) הימנע מתשובות עמומות כמו 'בהתאם' או 'לפי הצורך' בלי להסביר מה הלקוח אמור לעשות.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          field_key: fieldKey,
          field_meaning: fieldMeaning(fieldKey),
          raw_answer: answer,
          context: {
            business_name: collectedData.name || "",
            address: collectedData.address || "",
            previous_hours: collectedData.hours || "",
            field_specific_hint: fieldSpecificNormalizationHint(fieldKey),
            recent_messages: (Array.isArray(recentMessages) ? recentMessages : []).slice(-6),
          },
        },
        null,
        2
      ),
    },
  ];

  const raw = await chatCompletion(prompt, {
    apiKey: env.ADMIN_OPENAI_API_KEY || env.OPENAI_API_KEY,
    model: env.ADMIN_OPENAI_CHAT_MODEL,
    temperature: 0.3,
  });
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed.normalized_answer !== "string") {
    return {
      normalizedAnswer: answer,
      needsClarification: false,
      clarificationQuestion: "",
      note: "",
    };
  }

  const normalizedAnswer = postProcessNormalizedAnswer(
    fieldKey,
    String(parsed.normalized_answer || "").trim() || answer
  );
  const adjustedAnswer = applyFieldContextAdjustments(fieldKey, normalizedAnswer, collectedData);
  return {
    normalizedAnswer: adjustedAnswer,
    needsClarification: Boolean(parsed.needs_clarification),
    clarificationQuestion: String(parsed.clarification_question || "").trim(),
    note: String(parsed.note || "").trim(),
  };
}

async function composeOnboardingQuestion({ fieldKey, topic, collectedData = {} }) {
  const topicText = String(topic || fieldMeaning(fieldKey)).trim();
  if (fieldKey === "venue_style") {
    return "כדי להתאים את ההקמה, מה סוג העסק שלך? בר, מסעדה או בית קפה?";
  }
  if (fieldKey === "manager_code") {
    return "בחר קוד מנהל מאובטח (8+ תווים, אות גדולה, אות קטנה, מספר וסימן מיוחד).";
  }
  if (fieldKey === "extra") {
    return "יש עוד מידע חשוב שתרצה שאוסיף? אם לא, אפשר לכתוב: אין.";
  }
  if (fieldKey === "name") {
    return "איך קוראים לעסק?";
  }
  if (fieldKey === "phone_number") {
    return "לאיזה מספר לקוחות יכולים לפנות בוואטסאפ או בטלפון?";
  }
  if (fieldKey === "hours") {
    return "מה שעות הפעילות הרגילות שלכם?";
  }
  if (fieldKey === "holiday_hours") {
    return "יש שעות מיוחדות לחגים או ערבי חג?";
  }
  if (fieldKey === "address") {
    return "מה הכתובת המלאה של העסק?";
  }
  if (fieldKey === "navigation_link") {
    return "יש קישור ניווט שאפשר לשלוח ללקוחות? (Waze או Google Maps)";
  }
  if (fieldKey === "parking_enabled") {
    return "יש חניה נוחה ללקוחות? (כן/לא)";
  }
  if (fieldKey === "parking") {
    return "מעולה. תן פירוט קצר על החניה (חניון/כחול-לבן/חניה צמודה).";
  }
  if (fieldKey === "accessibility_enabled") {
    return "יש נגישות לנכים ולעגלות? (כן/לא)";
  }
  if (fieldKey === "accessibility") {
    return "מעולה. תן פירוט קצר על הנגישות (כניסה נגישה/שירותים/מעברים).";
  }
  if (fieldKey === "wifi_enabled") {
    return "יש Wi‑Fi ללקוחות? (כן/לא)";
  }
  if (fieldKey === "seating_areas") {
    return "אילו אזורי ישיבה יש אצלכם? בפנים, בחוץ, VIP או משהו נוסף?";
  }
  if (fieldKey === "seating_climate") {
    return "אם יושבים בחוץ, יש חימום/קירור/קירוי שכדאי לציין?";
  }
  if (fieldKey === "medical_kit") {
    return "יש משהו שחשוב לציין לגבי עזרה ראשונה או התנהלות מול אלרגנים?";
  }
  if (fieldKey === "baby_changing") {
    return "יש פינת החתלה בשירותים?";
  }
  if (fieldKey === "kosher_enabled") {
    return "יש לעסק כשרות? (כן/לא)";
  }
  if (fieldKey === "kosher") {
    return "איזו כשרות יש לכם?";
  }
  if (fieldKey === "wifi") {
    return "מעולה. מה פרטי ה‑Wi‑Fi שכדאי למסור ללקוחות?";
  }
  if (fieldKey === "deliveries_enabled") {
    return "יש לכם משלוחים? (כן/לא)";
  }
  if (fieldKey === "deliveries_details") {
    return "מעולה. באילו פלטפורמות/אזורים המשלוחים עובדים, ובאילו שעות?";
  }
  if (fieldKey === "deliveries_tracking") {
    return "איך הלקוח עוקב אחרי המשלוח? (לינק מעקב / אפליקציה / עדכון הודעות)";
  }
  if (fieldKey === "reservation_enabled") {
    return "ניתן להזמין אצלכם שולחן מראש? (כן/לא)";
  }
  if (fieldKey === "reservation") {
    return "איך מזמינים שולחן? שלח קישור הזמנה או מספר טלפון.";
  }
  if (fieldKey === "menu_main") {
    return "שלח קישור לתפריט האוכל העיקרי או פירוט קצר של המנות המרכזיות.";
  }
  if (fieldKey === "has_dessert_menu") {
    return "יש תפריט קינוחים נפרד? (כן/לא)";
  }
  if (fieldKey === "menu_dessert") {
    return "מעולה. שלח קישור/פירוט קצר של תפריט הקינוחים.";
  }
  if (fieldKey === "kids_menu_enabled") {
    return "יש תפריט ילדים? (כן/לא)";
  }
  if (fieldKey === "kids_menu") {
    return "מעולה. שלח קישור או פירוט קצר של תפריט הילדים.";
  }
  if (fieldKey === "alcohol_menu_enabled") {
    return "יש אצלכם תפריט אלכוהול נפרד מהתפריט הראשי? (כן/לא)";
  }
  if (fieldKey === "alcohol_menu") {
    return "מעולה. שלח קישור או פירוט קצר. אם האלכוהול מופיע בתפריט הראשי ואין תפריט נפרד, כתוב את זה במפורש.";
  }
  if (fieldKey === "business_lunch_brunch") {
    return "יש אצלכם עסקיות צהריים או בראנץ'?";
  }
  if (fieldKey === "vegan_vegetarian") {
    return "יש אצלכם מנות טבעוניות או צמחוניות שכדאי לציין?";
  }
  if (fieldKey === "gluten_free") {
    return "יש מנות ללא גלוטן או מידע חשוב שקשור לזה?";
  }
  if (fieldKey === "allergy_info") {
    return "מה האלרגנים המרכזיים שחשוב לציין ללקוחות (למשל בוטנים/אגוזים/שומשום)?";
  }
  if (fieldKey === "allergy_process") {
    return "כשלקוח שואל על אלרגיה, מה הנוהל המדויק אצלכם לפני שמתחייבים?";
  }
  if (fieldKey === "cross_contact_policy") {
    return "איך אתם מנסחים ללקוח את נושא הזיהום המשני במטבח (אם קיים)?";
  }
  if (fieldKey === "medical_diet_info") {
    return "יש הנחיות מיוחדות ללקוחות עם תזונה רפואית או רגישויות (למשל צליאק/סוכרת/לקטוז)?";
  }
  if (fieldKey === "milk_types") {
    return "יש סוגי חלב נוספים כמו סויה, שיבולת או שקדים?";
  }
  if (fieldKey === "payment") {
    return "איך לקוחות יכולים לשלם אצלכם?";
  }
  if (fieldKey === "customer_club_enabled") {
    return "יש לכם מועדון לקוחות? (כן/לא)";
  }
  if (fieldKey === "customer_club") {
    return "מעולה. איך מצטרפים למועדון הלקוחות ומה מקבלים?";
  }
  if (fieldKey === "gift_cards_enabled") {
    return "אתם מקבלים BuyMe או גיפט קארד? (כן/לא)";
  }
  if (fieldKey === "gift_cards") {
    return "מעולה. תן פירוט קצר לגבי הגיפט קארד / BuyMe.";
  }
  if (fieldKey === "inhouse_events_enabled") {
    return "יש אצלכם אירועי תוכן/קונספט קבועים במקום? (כן/לא)";
  }
  if (fieldKey === "inhouse_events") {
    return "איזה סוג אירועי תוכן בדרך כלל יש אצלכם (למשל טריוויה/סטנדאפ/קונספט)?";
  }
  if (fieldKey === "inhouse_events_entry_fee") {
    return "האם יש תשלום כניסה בחלק מהאירועים? אם כן, כתוב מתי וכמה.";
  }
  if (fieldKey === "inhouse_events_guidelines") {
    return "יש נהלים מיוחדים לאירועים (למשל הזמנה מראש, שעת פתיחת שערים או משך אירוע)?";
  }
  if (fieldKey === "private_events_enabled") {
    return "אפשר לקיים אצלכם אירועים פרטיים? (כן/לא)";
  }
  if (fieldKey === "private_events") {
    return "מעולה. לאילו סוגי אירועים פרטיים זה מתאים ואיך סוגרים את זה?";
  }
  if (fieldKey === "sports_broadcasts_enabled") {
    return "האם אתם משדרים שידורי ספורט במקום? (כן/לא)";
  }
  if (fieldKey === "sports_broadcasts") {
    return "מעולה. אילו שידורי ספורט יש בדרך כלל (משחקים/ליגות/ימים)?";
  }
  if (fieldKey === "music_enabled") {
    return "יש אצלכם מוזיקה קבועה או DJ? (כן/לא)";
  }
  if (fieldKey === "music_style") {
    return "מעולה. איזה סגנון מוזיקה יש אצלכם ובאילו ימים/שעות?";
  }
  if (fieldKey === "age_restriction") {
    return "האם יש הגבלת גיל לכניסה למקום? אם כן, פרט באילו ימים/שעות.";
  }
  if (fieldKey === "dress_code") {
    return "האם יש קוד לבוש בכניסה? אם כן, כתוב בקצרה מה נדרש.";
  }
  if (fieldKey === "discounts") {
    return "יש הנחות קבועות? פרט במפורש מי זכאי ומי לא (למשל חיילים/סטודנטים).";
  }
  if (fieldKey === "merchandise_enabled") {
    return "האם אתם מציעים מרצ'נדייז ללקוחות? (כן/לא)";
  }
  if (fieldKey === "merchandise") {
    return "מעולה. איזה מרצ'נדייז אפשר לרכוש אצלכם?";
  }
  if (fieldKey === "lost_found_enabled") {
    return "יש לכם נוהל אבדות ומציאות? (כן/לא)";
  }
  if (fieldKey === "lost_found") {
    return "מעולה. איך הלקוחות יכולים לפנות לגבי חפצים שנשכחו?";
  }
  if (fieldKey === "security_enabled") {
    return "יש אבטחה או מצלמות שכדאי לציין ללקוחות? (כן/לא)";
  }
  if (fieldKey === "security") {
    return "מה חשוב שלקוחות ידעו לגבי אבטחה במקום?";
  }
  if (fieldKey === "hiring_enabled") {
    return "האם אתם מגייסים עובדים כרגע? (כן/לא)";
  }
  if (fieldKey === "hiring") {
    return "לאילו תפקידים אתם מגייסים כרגע ואיך מגישים מועמדות?";
  }
  if (fieldKey === "human_representative") {
    return "אם לקוח רוצה לעבור לנציג אנושי, איך הוא יכול לפנות אליכם?";
  }
  if (fieldKey === "receipt_feedback") {
    return "אם לקוח צריך העתק קבלה, רוצה להשאיר משוב או להגיש תלונה, איך הוא פונה אליכם?";
  }
  const fallback = fallbackQuestionByTopic(topicText);
  if (!topicText) return fallback;

  const prompt = [
    {
      role: "system",
      content: [
        "אתה כותב שאלה אחת בלבד לבעל עסק בתהליך הקמה של בוט שירות.",
        "כתוב בעברית טבעית, תקינה וקלה להבנה.",
        "השאלה צריכה להתאים לנושא שניתן לך, בלי הסברים ארוכים.",
        "אורך מומלץ: משפט קצר אחד (עד ~20 מילים).",
        "אל תשתמש בניסוח רובוטי ואל תוסיף כותרות או רשימות.",
        "אל תזכיר את שם העסק בשאלה.",
        "כשמתאים, התחל את השאלה ב'האם'.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          field_key: fieldKey,
          topic: topicText,
          venue_style: collectedData.venue_style || "",
        },
        null,
        2
      ),
    },
  ];

  try {
    const raw = await chatCompletion(prompt, {
      apiKey: env.ADMIN_OPENAI_API_KEY || env.OPENAI_API_KEY,
      model: env.ADMIN_OPENAI_CHAT_MODEL,
      temperature: 0.6,
      fallbackText: fallback,
    });
    const question = String(raw || "").replace(/\s+/g, " ").trim();
    if (!question) return fallback;
    return /[?؟]$/.test(question) ? question : `${question}?`;
  } catch (_error) {
    return fallback;
  }
}

module.exports = { normalizeOnboardingAnswer, composeOnboardingQuestion };
