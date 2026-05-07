function normalizeLooseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/["'`״׳]/g, "")
    .replace(/[^\p{L}\p{N}\s:.-]/gu, " ")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!left) return right.length;
  if (!right) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[left.length][right.length];
}

function hasApproxWord(words, token, maxDistance = 1) {
  const cleanToken = normalizeLooseText(token);
  if (!cleanToken) return false;
  if (cleanToken.length <= 2) {
    return words.includes(cleanToken);
  }
  return words.some((word) => {
    if (word === cleanToken) return true;
    if (Math.abs(word.length - cleanToken.length) > maxDistance) return false;
    return levenshteinDistance(word, cleanToken) <= maxDistance;
  });
}

function includesTokenApprox(normalized, token, maxDistance = 1) {
  const cleanText = normalizeLooseText(normalized);
  const cleanToken = normalizeLooseText(token);
  if (!cleanText || !cleanToken) return false;
  if (cleanText.includes(cleanToken)) return true;

  const words = cleanText.split(" ").filter(Boolean);
  if (cleanToken.includes(" ")) {
    const parts = cleanToken.split(" ").filter(Boolean);
    return parts.every((part) => hasApproxWord(words, part, maxDistance));
  }
  return hasApproxWord(words, cleanToken, maxDistance);
}

function includesAnyToken(normalized, tokens = [], maxDistance = 1) {
  return tokens.some((token) => includesTokenApprox(normalized, token, maxDistance));
}

function isBranchQuestion(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const tokens = ["סניף", "סניפים", "איזה סניף", "באיזה סניף", "branch", "branches", "which branch"];
  return includesAnyToken(normalized, tokens, 1);
}

function isAddressQuestion(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const tokens = [
    "כתובת",
    "איפה",
    "מיקום",
    "איך מגיעים",
    "דרכי הגעה",
    "וויז",
    "ניווט",
    "רחוב",
    "איפה אתם",
    "how to get",
    "where are you",
    "address",
    "location",
    "waze",
    "navigation",
    "הגעתי",
  ];
  return isBranchQuestion(normalized) || includesAnyToken(normalized, tokens, 1);
}

function normalizeBusinessTypeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = normalizeLooseText(raw);
  if (!normalized) return "";
  if (includesAnyToken(normalized, ["בר", "פאב", "bar", "pub"], 1)) return "בר";
  if (includesAnyToken(normalized, ["בית קפה", "קפה", "cafe", "coffee"], 1)) return "בית קפה";
  if (includesAnyToken(normalized, ["מסעדה", "מסעד", "restaurant"], 1)) return "מסעדה";
  return raw;
}

function extractBusinessTypeFromItem(item) {
  const content = String(item?.content || "").trim();
  if (!content) return "";
  const normalized = normalizeLooseText(content);
  const markers = ["סוג העסק", "סגנון מקום", "venue style", "business type", "venue_type", "venue style"];
  const hasMarker = includesAnyToken(normalized, markers, 1);
  if (!hasMarker) return "";

  const value = extractKnowledgeValue(content);
  return normalizeBusinessTypeLabel(value);
}

function resolveBusinessTypeLabel(restaurant = {}, items = []) {
  const candidates = [
    restaurant?.business_type,
    restaurant?.venue_style,
    restaurant?.type,
    restaurant?.category,
    restaurant?.businessType,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBusinessTypeLabel(candidate);
    if (normalized) return normalized;
  }

  if (Array.isArray(items)) {
    for (const item of items) {
      const fromItem = extractBusinessTypeFromItem(item);
      if (fromItem) return fromItem;
    }
  }

  return "";
}

function isHumanRequestQuestion(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const tokens = [
    "נציג",
    "נציג אנושי",
    "בן אדם",
    "שירות אנושי",
    "human",
    "representative",
    "agent",
  ];
  return includesAnyToken(normalized, tokens, 1);
}

function isManagerRequestQuestion(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const tokens = ["מנהל", "מנהלת", "אחראי", "responsible", "manager"];
  return includesAnyToken(normalized, tokens, 1);
}

function isComplaintQuestion(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const tokens = [
    "תלונה",
    "מתלונן",
    "לא מרוצה",
    "שירות גרוע",
    "שירות לא טוב",
    "אכזבה",
    "מאוכזב",
    "מאוכזבת",
    "בושה",
    "complaint",
    "not happy",
    "bad service",
  ];
  return includesAnyToken(normalized, tokens, 1);
}

function isHiringQuestion(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const tokens = [
    "עבודה",
    "עובד",
    "עובדת",
    "משרה",
    "משרות",
    "דרושים",
    "דרוש",
    "קורות חיים",
    "cv",
    "resume",
    "job",
    "jobs",
    "career",
    "careers",
  ];
  return includesAnyToken(normalized, tokens, 1);
}

function isKosherQuestion(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const tokens = ["כשר", "כשרות", "מהדרין", "בדצ", "בדץ", "רבנות", "kosher"];
  return includesAnyToken(normalized, tokens, 1);
}

function isAllergyQuestion(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const tokens = [
    "אלרג",
    "רגיש",
    "רגישות",
    "בוטנ",
    "אגוז",
    "שומשום",
    "לקטוז",
    "גלוטן",
    "צליאק",
    "אנפיל",
    "allergy",
    "allergic",
    "intolerance",
    "gluten",
    "celiac",
    "nut",
    "sesame",
  ];
  return includesAnyToken(normalized, tokens, 1);
}

function isMedicalDietQuestion(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const tokens = [
    "תזונה רפוא",
    "דיאטה רפוא",
    "מצב רפוא",
    "סוכרת",
    "לחץ דם",
    "כולסטרול",
    "הריון",
    "בהריון",
    "הנקה",
    "תרופות",
    "medical diet",
    "medical condition",
    "diabet",
    "pregnan",
    "breastfeeding",
    "medication",
  ];
  return includesAnyToken(normalized, tokens, 1);
}

function isHighRiskRequestQuestion(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const tokens = [
    "מסכן חיים",
    "סיכון גבוה",
    "חירום",
    "מיון",
    "הרעלה",
    "אנפילקס",
    "אנפילקט",
    "מסוכן לי",
    "בטוח לי",
    "סכנת חיים",
    "medical emergency",
    "high risk",
    "anaphylaxis",
    "poisoning",
    "unsafe",
  ];
  return includesAnyToken(normalized, tokens, 1);
}

function isNudgeOnly(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return /^[\?\!\.\,\-_\s]+$/.test(raw);
}

function normalizeKnowledgeContent(content) {
  return String(content || "").replace(/\s+/g, " ").trim();
}

function extractKnowledgeValue(content) {
  const clean = normalizeKnowledgeContent(content);
  if (!clean) return "";
  const idx = clean.indexOf(":");
  if (idx <= 0 || idx > 80) {
    return clean;
  }
  return clean.slice(idx + 1).trim() || clean;
}

function getScore(item) {
  if (!item || typeof item.score !== "number" || !Number.isFinite(item.score)) {
    return null;
  }
  return item.score;
}

function looksLikeAddressKnowledge(item) {
  const category = normalizeLooseText(item?.category || "");
  const content = normalizeLooseText(item?.content || "");
  if (!content) return false;
  if (category === "address" || category === "navigation" || category === "location") return true;
  const addressTokens = ["כתובת", "רחוב", "שדרות", "מיקום", "ניווט", "וויז", "waze", "location", "address"];
  return includesAnyToken(content, addressTokens, 1);
}

function pickBestAddressFact(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const relevant = items.filter(looksLikeAddressKnowledge);
  if (relevant.length === 0) {
    return null;
  }
  const scored = relevant
    .map((item) => ({ item, score: getScore(item) }))
    .sort((a, b) => {
      const as = a.score == null ? -1 : a.score;
      const bs = b.score == null ? -1 : b.score;
      return bs - as;
    });
  const winner = scored[0];
  if (!winner) {
    return null;
  }
  const winnerCategory = normalizeLooseText(winner.item?.category || "");
  const strictAddressCategory = winnerCategory === "address" || winnerCategory === "navigation" || winnerCategory === "location";
  if (!strictAddressCategory && winner.score != null && winner.score < 0.2) {
    return null;
  }
  const fact = extractKnowledgeValue(winner.item?.content || "");
  if (!fact) {
    return null;
  }
  return fact;
}

function looksLikeKosherKnowledge(item) {
  const category = normalizeLooseText(item?.category || "");
  const content = normalizeLooseText(item?.content || "");
  if (!content) return false;
  if (category === "kosher") return true;
  const tokens = ["כשר", "כשרות", "מהדרין", "בדצ", "בדץ", "רבנות", "kosher"];
  return includesAnyToken(content, tokens, 1);
}

function pickBestKosherFact(items = []) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const relevant = items.filter(looksLikeKosherKnowledge);
  if (relevant.length === 0) return null;
  const scored = relevant
    .map((item) => ({ item, score: getScore(item) }))
    .sort((a, b) => {
      const as = a.score == null ? -1 : a.score;
      const bs = b.score == null ? -1 : b.score;
      return bs - as;
    });
  const winner = scored[0];
  if (!winner) return null;
  if (winner.score != null && winner.score < 0.2) return null;
  const fact = extractKnowledgeValue(winner.item?.content || "");
  return fact || null;
}

function looksLikeHiringKnowledge(item) {
  const category = normalizeLooseText(item?.category || "");
  const content = normalizeLooseText(item?.content || "");
  if (!content) return false;
  if (category === "hiring") return true;
  const tokens = ["עבודה", "משרה", "דרושים", "קורות חיים", "job", "career", "resume"];
  return includesAnyToken(content, tokens, 1);
}

function pickBestHiringFact(items = []) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const relevant = items.filter(looksLikeHiringKnowledge);
  if (relevant.length === 0) return null;
  const scored = relevant
    .map((item) => ({ item, score: getScore(item) }))
    .sort((a, b) => {
      const as = a.score == null ? -1 : a.score;
      const bs = b.score == null ? -1 : b.score;
      return bs - as;
    });
  const winner = scored[0];
  if (!winner) return null;
  if (winner.score != null && winner.score < 0.2) return null;
  const fact = extractKnowledgeValue(winner.item?.content || "");
  return fact || null;
}

function looksLikeHealthSafetyKnowledge(item) {
  const category = normalizeLooseText(item?.category || "");
  const content = normalizeLooseText(item?.content || "");
  if (!content) return false;
  if (category === "allergy" || category === "health" || category === "medical" || category === "safety") return true;
  const tokens = [
    "אלרג",
    "רגיש",
    "רגישות",
    "גלוטן",
    "צליאק",
    "לקטוז",
    "בוטנ",
    "אגוז",
    "שומשום",
    "זיהום משני",
    "cross contact",
    "medical",
    "allerg",
    "intolerance",
    "celiac",
    "gluten",
  ];
  return includesAnyToken(content, tokens, 1);
}

function pickBestHealthSafetyFact(items = []) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const relevant = items.filter(looksLikeHealthSafetyKnowledge);
  if (relevant.length === 0) return null;
  const scored = relevant
    .map((item) => ({ item, score: getScore(item) }))
    .sort((a, b) => {
      const as = a.score == null ? -1 : a.score;
      const bs = b.score == null ? -1 : b.score;
      return bs - as;
    });
  const winner = scored[0];
  if (!winner) return null;
  if (winner.score != null && winner.score < 0.22) return null;
  const fact = extractKnowledgeValue(winner.item?.content || "");
  return fact || null;
}

const TOPIC_QUERY_RULES = [
  { topic: "deliveries", queryTokens: ["משלוח", "וולט", "תן ביס", "סיבוס", "delivery", "deliveries"], contentTokens: ["משלוח", "וולט", "תן ביס", "סיבוס"] },
  { topic: "gift_cards", queryTokens: ["buyme", "ביימי", "גיפט", "שובר"], contentTokens: ["buyme", "ביימי", "גיפט", "שובר"] },
  {
    topic: "events",
    queryTokens: ["אירוע", "אירועים", "הופעה", "dj", "מוצש", "מוצאי שבת", "מיוחד היום", "משהו מיוחד"],
    contentTokens: ["אירוע", "אירועים", "הופעה", "dj"],
    relatedContentTokens: ["מחיר", "תשלום", "כניסה", "כרטיס", "פיקדון", "מינימום", "deposit", "ticket", "entry fee"],
  },
  {
    topic: "reservation",
    queryTokens: ["להזמין שולחן", "הזמנת שולחן", "שולחן", "reserv"],
    contentTokens: ["הזמנת שולחן", "שולחן", "reservation", "ontopo"],
    relatedContentTokens: ["פיקדון", "דמי ביטול", "מינימום", "אשראי", "תשלום", "deposit", "cancellation", "fee"],
  },
  { topic: "menu", queryTokens: ["תפריט", "מנה", "מנות", "menu"], contentTokens: ["תפריט", "מנה", "מנות", "menu"] },
  { topic: "wifi", queryTokens: ["wifi", "וויי", "סיסמה"], contentTokens: ["wifi", "וויי", "סיסמה"] },
  { topic: "accessibility", queryTokens: ["נגיש", "עגלה", "נכים"], contentTokens: ["נגיש", "עגלה", "נכים"] },
  { topic: "parking", queryTokens: ["חניה", "חניון", "כחול לבן"], contentTokens: ["חניה", "חניון", "כחול"] },
  { topic: "hours", queryTokens: ["שעה", "שעות", "פתוח", "פתוחים", "סגור", "חג"], contentTokens: ["שעות", "פתוח", "סגור", "חג"] },
];

function hasDayOfWeekMention(normalizedText) {
  return includesAnyToken(normalizedText, ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "מוצש", "מוצאי שבת"], 1);
}

function looksLikeHoursQuestion(normalizedText) {
  return includesAnyToken(normalizedText, ["מתי", "שעות", "פתוח", "פתוחים", "נפתח", "סגור", "סוגרים", "עד מתי"], 1);
}

function looksLikeEventQuestion(normalizedText) {
  return includesAnyToken(
    normalizedText,
    ["אירוע", "אירועים", "הופעה", "dj", "זמר", "זמרת", "מה יש", "מה קורה", "מי מופיע", "מה מיוחד", "משהו מיוחד"],
    1
  );
}

function detectScopeTagsFromItem(item = {}) {
  const known = Array.isArray(item.scope_tags)
    ? item.scope_tags.map((scope) => normalizeLooseText(scope)).filter(Boolean)
    : [];
  const inferredText = [
    String(item.category || ""),
    String(item.content || ""),
    String(item.topic_title || ""),
    String(item.sample_question || ""),
    String(item.answer_text || ""),
    String(item.context_note || ""),
  ].join(" ");
  const scopes = new Set(known);
  const normalized = normalizeLooseText(inferredText);
  if (includesAnyToken(normalized, ["אירוע", "אירועים", "הופעה", "זמר", "dj", "מוצש", "מוצאי שבת"], 1)) scopes.add("events");
  if (includesAnyToken(normalized, ["שולחן", "הזמנה", "reservation", "ontopo", "קבוצה", "דמי ביטול"], 1)) scopes.add("reservation");
  if (includesAnyToken(normalized, ["מחיר", "תשלום", "פיקדון", "דמי", "כרטיס", "חינם", "שח", "ש\"ח", "fee", "deposit"], 1)) scopes.add("payment");
  return scopes;
}

function isRelatedItemCompatible(topic, item = {}) {
  const scopes = detectScopeTagsFromItem(item);
  if (topic === "events") {
    return scopes.has("events") && scopes.has("payment");
  }
  if (topic === "reservation") {
    return scopes.has("reservation") && scopes.has("payment");
  }
  return true;
}

function detectTopicRule(text) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return null;
  const eventRule = TOPIC_QUERY_RULES.find((rule) => rule.topic === "events") || null;
  if (
    eventRule
    && hasDayOfWeekMention(normalized)
    && looksLikeEventQuestion(normalized)
    && !looksLikeHoursQuestion(normalized)
  ) {
    return eventRule;
  }
  return TOPIC_QUERY_RULES.find((rule) => includesAnyToken(normalized, rule.queryTokens, 1)) || null;
}

function filterKnowledgeItemsForQuery(items = [], queryText = "") {
  if (!Array.isArray(items) || items.length === 0) {
    return { items: [], topic: null, strictTopicMatch: false };
  }
  const rule = detectTopicRule(queryText);
  if (!rule) {
    return { items, topic: null, strictTopicMatch: false };
  }
  const directMatches = items.filter((item) => {
    const content = normalizeLooseText(item?.content || "");
    const category = normalizeLooseText(item?.category || "");
    const topicTitle = normalizeLooseText(item?.topic_title || "");
    const sampleQuestion = normalizeLooseText(item?.sample_question || "");
    const answerText = normalizeLooseText(item?.answer_text || "");
    return (
      includesAnyToken(content, rule.contentTokens, 1)
      || includesAnyToken(category, rule.contentTokens, 1)
      || includesAnyToken(topicTitle, rule.contentTokens, 1)
      || includesAnyToken(sampleQuestion, rule.contentTokens, 1)
      || includesAnyToken(answerText, rule.contentTokens, 1)
    );
  });
  if (directMatches.length === 0) {
    return { items: [], topic: rule.topic, strictTopicMatch: true };
  }
  const relatedTokens = Array.isArray(rule.relatedContentTokens) ? rule.relatedContentTokens : [];
  if (relatedTokens.length === 0) {
    return { items: directMatches, topic: rule.topic, strictTopicMatch: true };
  }
  const relatedMatches = items.filter((item) => {
    if (directMatches.includes(item)) return false;
    const content = normalizeLooseText(item?.content || "");
    const category = normalizeLooseText(item?.category || "");
    const topicTitle = normalizeLooseText(item?.topic_title || "");
    const sampleQuestion = normalizeLooseText(item?.sample_question || "");
    const answerText = normalizeLooseText(item?.answer_text || "");
    const tokenMatch = (
      includesAnyToken(content, relatedTokens, 1)
      || includesAnyToken(category, relatedTokens, 1)
      || includesAnyToken(topicTitle, relatedTokens, 1)
      || includesAnyToken(sampleQuestion, relatedTokens, 1)
      || includesAnyToken(answerText, relatedTokens, 1)
    );
    if (!tokenMatch) return false;
    return isRelatedItemCompatible(rule.topic, item);
  });
  return { items: [...directMatches, ...relatedMatches], topic: rule.topic, strictTopicMatch: true };
}

function buildContextFromItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items.map((item) => {
    const category = String(item?.category || "").trim() || "custom";
    if (category !== "custom") {
      return `[${category}] ${item.content}`;
    }
    const topicTitle = String(item?.topic_title || "").trim();
    const answerText = String(item?.answer_text || "").trim();
    const sampleQuestion = String(item?.sample_question || "").trim();
    const answerStyle = String(item?.answer_style || "").trim();
    const contextNote = String(item?.context_note || "").trim();
    if (!topicTitle && !answerText) {
      return `[${category}] ${item.content}`;
    }
    return [
      "[custom]",
      topicTitle ? `נושא: ${topicTitle}` : null,
      sampleQuestion ? `שאלה לדוגמה: ${sampleQuestion}` : null,
      answerText ? `תשובה מאומתת: ${answerText}` : String(item?.content || "").trim(),
      contextNote ? `הקשר: ${contextNote}` : null,
      answerStyle === "bullets"
        ? "תצוגה מועדפת: בולטים קצרים כשמתאים."
        : "תצוגה מועדפת: פסקה קצרה וישירה.",
    ].filter(Boolean).join("\n");
  }).join("\n");
}

function buildRetrievalQuery(currentText, conversationHistory = []) {
  const current = String(currentText || "").trim();
  const normalizedCurrent = normalizeLooseText(current);
  if (!normalizedCurrent) return "";
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return current;
  }

  const previousUserMessage = [...conversationHistory]
    .reverse()
    .find((m) => m?.role === "user" && normalizeLooseText(m.content))?.content;

  if (!previousUserMessage) return current;

  const followupPrefixes = [
    "איזה",
    "ואיזה",
    "באיזה",
    "ואיפה",
    "ומה",
    "ומתי",
    "שם",
    "ושם",
    "which",
    "and where",
  ];
  const wordCount = normalizedCurrent.split(" ").filter(Boolean).length;
  const looksLikeFollowup = followupPrefixes.some((prefix) => normalizedCurrent.startsWith(prefix));
  const shouldBlend = isBranchQuestion(normalizedCurrent) || (isAddressQuestion(normalizedCurrent) && (looksLikeFollowup || wordCount <= 3));

  if (!shouldBlend) return current;
  return `${String(previousUserMessage || "").trim()} ${current}`.trim();
}

function normalizeAssistantVoice(text) {
  const raw = String(text || "");
  if (!raw.trim()) return "";
  return raw
    .replace(/אני פתוחים/g, "אנחנו פתוחים")
    .replace(/אני סגורים/g, "אנחנו סגורים")
    .replace(/אני כשרים/g, "אנחנו כשרים")
    .replace(/אני לא מקבלים/g, "אנחנו לא מקבלים")
    .replace(/אני לא מציעים/g, "אנחנו לא מציעים")
    .replace(/אני לא עובדים/g, "אנחנו לא עובדים")
    .replace(/אני מקיימים/g, "אנחנו מקיימים")
    .replace(/אני מציעים/g, "אנחנו מציעים")
    .replace(/אני עובדים עם/g, "אנחנו עובדים עם")
    .replace(/אני שומרים/g, "אנחנו שומרים")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  normalizeLooseText,
  isAddressQuestion,
  isBranchQuestion,
  resolveBusinessTypeLabel,
  isHumanRequestQuestion,
  isManagerRequestQuestion,
  isComplaintQuestion,
  isHiringQuestion,
  isKosherQuestion,
  isAllergyQuestion,
  isMedicalDietQuestion,
  isHighRiskRequestQuestion,
  isNudgeOnly,
  extractKnowledgeValue,
  pickBestAddressFact,
  pickBestKosherFact,
  pickBestHiringFact,
  pickBestHealthSafetyFact,
  filterKnowledgeItemsForQuery,
  buildContextFromItems,
  buildRetrievalQuery,
  normalizeAssistantVoice,
};
