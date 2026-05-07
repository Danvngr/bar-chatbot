const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getOnboardingQuestionPlan,
  buildKnowledgeBase,
  buildProvisionPayload,
} = require("../../src/services/onboardingFlow");

test("onboarding plan keeps Telegram connection out of manual setup questions", () => {
  const plan = getOnboardingQuestionPlan({ venue_style: "מסעדה" });
  const keys = plan.map((q) => q.key);

  assert.equal(keys.includes("telegram_recipients"), false);
  assert.equal(keys.includes("manager_code"), true);
  assert.equal(keys.includes("extra"), true);
});

test("provision payload initializes Telegram recipients only through connect-code flow", () => {
  const payload = buildProvisionPayload({
    adminPhone: "0501234567",
    inviteCode: "AB12",
    collectedData: {
      venue_style: "מסעדה",
      name: "מסעדת הדגמה",
      phone_number: "0501111111",
      hours: "ראשון-חמישי 12:00-23:00",
      address: "רחוב הדגמה 1",
      payment: "אשראי ומזומן",
      manager_code: "Aa123456!",
      telegram_recipients: "123456",
    },
  });

  assert.deepEqual(payload.telegram_recipients, []);
  assert.equal(payload.restaurant_id.startsWith("מסעדת_הדגמה_"), true);
});

test("knowledge base excludes management-only fields", () => {
  const kb = buildKnowledgeBase({
    venue_style: "מסעדה",
    name: "מסעדת הדגמה",
    phone_number: "0501111111",
    hours: "ראשון-חמישי 12:00-23:00",
    manager_code: "Aa123456!",
    telegram_recipients: "TG-ABCD-1234",
    extra: "אין",
  });

  const content = kb.map((item) => item.content).join("\n");
  assert.doesNotMatch(content, /Aa123456!/);
  assert.doesNotMatch(content, /TG-ABCD-1234/);
});
