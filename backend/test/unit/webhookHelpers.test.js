const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isNudgeOnly,
  isAddressQuestion,
  isBranchQuestion,
  resolveBusinessTypeLabel,
  isHiringQuestion,
  isKosherQuestion,
  isAllergyQuestion,
  isMedicalDietQuestion,
  isHighRiskRequestQuestion,
  isHumanRequestQuestion,
  pickBestAddressFact,
  pickBestHiringFact,
  pickBestHealthSafetyFact,
  filterKnowledgeItemsForQuery,
  buildRetrievalQuery,
  extractKnowledgeValue,
  normalizeAssistantVoice,
} = require("../../src/routes/webhookHelpers");

test("isNudgeOnly identifies punctuation-only nudges", () => {
  assert.equal(isNudgeOnly("?"), true);
  assert.equal(isNudgeOnly("??!!"), true);
  assert.equal(isNudgeOnly("? מתי פתוחים"), false);
});

test("isAddressQuestion and isBranchQuestion tolerate small typos", () => {
  assert.equal(isAddressQuestion("איזה סניפ יש פה?"), true);
  assert.equal(isBranchQuestion("באיזה סניפ מדובר?"), true);
});

test("isHiringQuestion detects common hiring intents", () => {
  assert.equal(isHiringQuestion("אפשר לשלוח קורות חיים?"), true);
  assert.equal(isHiringQuestion("יש משרות פתוחות?"), true);
  assert.equal(isHiringQuestion("מה שעות פתיחה היום?"), false);
});

test("isKosherQuestion tolerates missing punctuation and light typo", () => {
  assert.equal(isKosherQuestion("יש כשרותת אצלכם"), true);
  assert.equal(isKosherQuestion("כשר?"), true);
});

test("health-risk detectors identify allergy and medical risk intents", () => {
  assert.equal(isAllergyQuestion("יש אצלכם אלרגיה לבוטנים במנות?"), true);
  assert.equal(isMedicalDietQuestion("יש משהו שמתאים לסוכרת?"), true);
  assert.equal(isHighRiskRequestQuestion("זה מסכן חיים, יש זיהום משני?"), true);
});

test("isHumanRequestQuestion detects explicit handoff intent", () => {
  assert.equal(isHumanRequestQuestion("אפשר נציג אנושי?"), true);
  assert.equal(isHumanRequestQuestion("דבר איתי בן אדם"), true);
  assert.equal(isHumanRequestQuestion("מה הכשרות שלכם?"), false);
});

test("extractKnowledgeValue strips prefix when present", () => {
  assert.equal(extractKnowledgeValue("כתובת ומיקום מדויק: רחוב הדגמה 34"), "רחוב הדגמה 34");
  assert.equal(extractKnowledgeValue("רבנות מקומית"), "רבנות מקומית");
});

test("pickBestAddressFact returns highest relevant address fact", () => {
  const fact = pickBestAddressFact([
    { category: "custom", content: "חניה: יש ליד הקניון", score: 0.81 },
    { category: "address", content: "כתובת: רחוב הדגמה 34", score: 0.42 },
    { category: "address", content: "כתובת: בר כוכבא 10, פתח תקווה", score: 0.11 },
  ]);
  assert.equal(fact, "רחוב הדגמה 34");
});

test("pickBestHiringFact returns best hiring fact and ignores weak match", () => {
  const strong = pickBestHiringFact([
    { category: "hiring", content: "גיוס עובדים: אפשר לשלוח קורות חיים ל-0521234567", score: 0.4 },
  ]);
  const weak = pickBestHiringFact([
    { category: "hiring", content: "גיוס עובדים: שלחו פרטים", score: 0.1 },
  ]);
  assert.equal(strong, "אפשר לשלוח קורות חיים ל-0521234567");
  assert.equal(weak, null);
});

test("pickBestHealthSafetyFact returns health fact and ignores weak match", () => {
  const strong = pickBestHealthSafetyFact([
    { category: "custom", content: "אלרגיות: אנחנו בודקים מול המטבח לפני אישור", score: 0.42 },
  ]);
  const weak = pickBestHealthSafetyFact([
    { category: "custom", content: "אלרגיות: תשאלו במקום", score: 0.12 },
  ]);
  assert.equal(strong, "אנחנו בודקים מול המטבח לפני אישור");
  assert.equal(weak, null);
});

test("normalizeAssistantVoice keeps valid collective business phrasing", () => {
  assert.equal(normalizeAssistantVoice("אנחנו כשרים ויש לנו אזור VIP"), "אנחנו כשרים ויש לנו אזור VIP");
  assert.equal(
    normalizeAssistantVoice("יש לנו אזור ייעודי לעישון, ואני כאן לעוד שאלות נוספות"),
    "יש לנו אזור ייעודי לעישון, ואני כאן לעוד שאלות נוספות",
  );
  assert.equal(normalizeAssistantVoice("אני לא מקבלים הזמנות בטלפון"), "אנחנו לא מקבלים הזמנות בטלפון");
});

test("buildRetrievalQuery enriches short branch follow-up with previous context", () => {
  const query = buildRetrievalQuery("איזה סניפ?", [
    { role: "assistant", content: "כן, הגעת למקום הנכון." },
    { role: "user", content: "הגעתי למקום הנכון?" },
  ]);
  assert.match(query, /הגעתי למקום הנכון/);
  assert.match(query, /איזה סניפ/);
});

test("resolveBusinessTypeLabel prefers restaurant fields and normalizes value", () => {
  assert.equal(resolveBusinessTypeLabel({ venue_style: "bar" }, []), "בר");
  assert.equal(resolveBusinessTypeLabel({ business_type: "בית קפה" }, []), "בית קפה");
});

test("resolveBusinessTypeLabel can derive type from knowledge item", () => {
  const type = resolveBusinessTypeLabel(
    {},
    [{ category: "custom", content: "סוג העסק: מסעדה איטלקית" }],
  );
  assert.equal(type, "מסעדה");
});

test("filterKnowledgeItemsForQuery detects menu topic", () => {
  const result = filterKnowledgeItemsForQuery(
    [{ category: "menu", content: "תפריט: פסטות ופיצות", score: 0.45 }],
    "אפשר תפריט?",
  );
  assert.equal(result.topic, "menu");
  assert.equal(result.strictTopicMatch, true);
  assert.equal(result.items.length, 1);
});

