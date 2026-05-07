const test = require("node:test");
const assert = require("node:assert/strict");

const { ALLOWED_ACTIONS, buildAdminClassifierPrompt, buildAdminSummary } = require("../../src/utils/adminPromptBuilder");

test("admin parser supports updating existing custom knowledge", () => {
  assert.equal(ALLOWED_ACTIONS.includes("update_custom"), true);
  assert.equal(ALLOWED_ACTIONS.includes("continue_previous_list"), true);

  const summary = buildAdminSummary("update_custom", {
    target_text: "תפריט",
    content: "התפריט המעודכן נמצא בקישור החדש.",
  });

  assert.match(summary, /סיכום עריכת מידע/);
  assert.match(summary, /תפריט/);
  assert.match(summary, /התפריט המעודכן/);
});

test("admin classifier prompt includes contextual understanding guidance", () => {
  const messages = buildAdminClassifierPrompt({
    messageText: "תשלח לי את השאלות",
    recentMessages: [
      { role: "assistant", content: "זה מה ששמור כרגע בנושא \"השאלות\"" },
      { role: "user", content: "זה?" },
    ],
  });

  assert.match(messages[0].content, /You are not a keyword matcher/);
  assert.match(messages[0].content, /For action view_knowledge/);
  assert.match(messages[0].content, /For action continue_previous_list/);
  assert.match(messages[0].content, /תשלחי עוד/);
  assert.match(messages[0].content, /תשלח לי את השאלות/);
  assert.match(messages[0].content, /האם יש משהו על/);
  assert.match(messages[0].content, /Do not use update_custom for a question/);

  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.message, "תשלח לי את השאלות");
  assert.equal(payload.recent_messages.length, 2);
  assert.equal(payload.recent_messages[0].content, "זה מה ששמור כרגע בנושא \"השאלות\"");
});
