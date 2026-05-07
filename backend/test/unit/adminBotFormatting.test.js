const test = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../../src/services/adminBot");

test("formatKnowledgeItemForManager shows Hebrew topic and saved answer", () => {
  const text = __test__.formatKnowledgeItemForManager(
    {
      category: "hours",
      content: "שעות פתיחה וסגירת מטבח: ראשון-חמישי 12:00-23:00",
    },
    0,
    1
  );

  assert.match(text, /• \*שעות פתיחה וסגירת מטבח:\*/);
  assert.match(text, /ראשון-חמישי 12:00-23:00/);
  assert.doesNotMatch(text, /\[hours\]|hours/);
});

test("formatKnowledgeItemForManager translates technical category fallback", () => {
  const text = __test__.formatKnowledgeItemForManager(
    {
      category: "address",
      content: "רחוב הדגמה 1",
    },
    0,
    1
  );

  assert.match(text, /כתובת ומיקום/);
  assert.match(text, /רחוב הדגמה 1/);
  assert.doesNotMatch(text, /\[address\]|address/);
});

test("buildKnowledgeListPage shows page range and continue hint", () => {
  const docs = Array.from({ length: 22 }, (_, idx) => ({
    category: idx % 2 === 0 ? "hours" : "menu",
    content: `נושא ${idx + 1}: תשובה ${idx + 1}`,
  }));

  const page = __test__.buildKnowledgeListPage(docs, 0, 20);

  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 20);
  assert.equal(page.total, 22);
  assert.match(page.text, /1-20 מתוך 22/);
  assert.match(page.text, /כתוב \*המשך\* או \*עוד\*/);
  assert.match(page.text, /נושא 20/);
  assert.doesNotMatch(page.text, /נושא 21/);
});

test("buildKnowledgeListPage final page marks list complete", () => {
  const docs = Array.from({ length: 22 }, (_, idx) => ({
    category: "custom",
    content: `נושא ${idx + 1}: תשובה ${idx + 1}`,
  }));

  const page = __test__.buildKnowledgeListPage(docs, 20, 20);

  assert.equal(page.hasMore, false);
  assert.equal(page.nextOffset, 22);
  assert.match(page.text, /21-22 מתוך 22/);
  assert.match(page.text, /זה כל המידע ששמור כרגע/);
  assert.match(page.text, /נושא 21/);
  assert.match(page.text, /נושא 22/);
});

test("knowledge list continue words require active pagination state", () => {
  assert.equal(__test__.isKnowledgeListContinueText("המשך"), true);
  assert.equal(__test__.isKnowledgeListContinueText("את הכל"), true);
  assert.equal(__test__.isKnowledgeListContinueText("תשלח הכל"), true);
  assert.equal(__test__.isKnowledgeListContinueText("תשלחי עוד"), true);
  assert.equal(__test__.isKnowledgeListContinueText("אפשר לראות עוד?"), true);
  assert.equal(__test__.isKnowledgeListContinueText("שלום"), false);

  assert.equal(__test__.getActiveKnowledgeListState({ collected_data: {} }), null);
  assert.equal(
    __test__.getActiveKnowledgeListState({
      collected_data: {
        knowledge_list_pagination: {
          next_offset: 20,
          expires_at: Date.now() - 1,
        },
      },
    }),
    null
  );
  assert.equal(
    __test__.getActiveKnowledgeListState({
      collected_data: {
        knowledge_list_pagination: {
          next_offset: 20,
          expires_at: Date.now() + 10000,
        },
      },
    }).next_offset,
    20
  );
});

test("adminIntentRecentMessages prepares recent context for AI parser", () => {
  const messages = __test__.adminIntentRecentMessages({
    messages: [
      { role: "user", content: "הודעה ישנה" },
      { role: "assistant", content: "זה מה ששמור כרגע בנושא \"השאלות\"" },
      { role: "user", content: "זה?" },
    ],
  });

  assert.deepEqual(messages, [
    { role: "user", content: "הודעה ישנה" },
    { role: "assistant", content: "זה מה ששמור כרגע בנושא \"השאלות\"" },
    { role: "user", content: "זה?" },
  ]);
});

test("adminIntentContextData exposes active pagination safely", () => {
  const context = __test__.adminIntentContextData({
    state: "IDLE",
    pending_action: null,
    collected_data: {
      knowledge_list_pagination: {
        next_offset: 20,
        total: 41,
        page_size: 20,
        expires_at: Date.now() + 10000,
      },
      manager_code: "Secret123!",
    },
  });

  assert.equal(context.current_state, "IDLE");
  assert.equal(context.knowledge_list_pagination.active, true);
  assert.equal(context.knowledge_list_pagination.next_offset, 20);
  assert.equal(context.knowledge_list_pagination.total, 41);
  assert.equal(context.manager_code, undefined);
});
