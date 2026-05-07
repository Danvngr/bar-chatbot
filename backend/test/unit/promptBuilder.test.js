const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPrompt } = require("../../src/utils/promptBuilder");

test("buildPrompt allows collective business phrasing while keeping a human speaker", () => {
  const messages = buildPrompt({
    systemPromptBase: "base",
    ragContext: "כשרות: כשר",
    conversationHistory: [{ role: "user", content: "היי" }],
    nowContext: "היום...",
    restaurantName: "מסעדת הבית",
    businessType: "בר",
    semanticUnderstanding: {
      intent: "place_identity",
      confidence: 0.91,
      answer_style: "minimal",
      retrieval_query: "לאן הגעתי",
    },
  });

  assert.equal(Array.isArray(messages), true);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /אדם יחיד מהצוות/);
  assert.match(messages[0].content, /מותר לגמרי לומר "אנחנו", "יש לנו"/);
  assert.match(messages[0].content, /ואני כאן לכל שאלה נוספת/);
  assert.match(messages[0].content, /סוג העסק: בר/);
  assert.match(messages[0].content, /זה בר: שמור על טון ערב/);
  assert.match(messages[0].content, /=== הבנת ההודעה הנוכחית ===/);
  assert.match(messages[0].content, /intent מוערך: place_identity/);
  assert.match(messages[0].content, /אל תוסיף פרטים צדדיים שלא התבקשו/);
});

