const test = require("node:test");
const assert = require("node:assert/strict");

const { validateOnboardingField } = require("../../src/services/onboardingValidation");

test("validateOnboardingField rejects empty kosher value", () => {
  const result = validateOnboardingField("kosher", "");
  assert.equal(result.valid, false);
  assert.match(result.message, /כשרות/);
});

test("validateOnboardingField accepts kosher value", () => {
  const result = validateOnboardingField("kosher", "כשר למהדרין");
  assert.equal(result.valid, true);
});

test("validateOnboardingField enforces yes/no on kosher_enabled", () => {
  const bad = validateOnboardingField("kosher_enabled", "אולי");
  const good = validateOnboardingField("kosher_enabled", "כן");
  assert.equal(bad.valid, false);
  assert.equal(good.valid, true);
});

