const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function srcPath(relativeFromSrc) {
  return require.resolve(path.resolve(__dirname, "../../src", relativeFromSrc));
}

function setMock(relativeFromSrc, exportsValue) {
  const abs = srcPath(relativeFromSrc);
  require.cache[abs] = {
    id: abs,
    filename: abs,
    loaded: true,
    exports: exportsValue,
  };
}

function resetWhatsAppModules() {
  [
    "services/whatsapp.js",
    "services/telegram.js",
    "config/firebase.js",
    "config/env.js",
    "utils/retry.js",
  ].forEach((rel) => {
    const abs = srcPath(rel);
    delete require.cache[abs];
  });
}

test("notifyAdminTransfer routes handoff notification to Telegram", async () => {
  resetWhatsAppModules();

  const telegramCalls = [];
  setMock("config/env.js", {
    WHATSAPP_API_VERSION: "v21.0",
    WHATSAPP_ACCESS_TOKEN: "wa-token",
    WHATSAPP_PHONE_NUMBER_ID: "wa-phone",
  });
  setMock("config/firebase.js", {
    db: {
      collection(name) {
        assert.equal(name, "restaurants");
        return {
          doc(id) {
            assert.equal(id, "rest_1");
            return {
              async get() {
                return {
                  exists: true,
                  data: () => ({
                    name: "מסעדת הדגמה",
                    telegram_recipients: [{ chat_id: "123", enabled: true }],
                  }),
                };
              },
            };
          },
        };
      },
    },
  });
  setMock("services/telegram.js", {
    notifyTelegramHandoff: async (payload) => {
      telegramCalls.push(payload);
      return { sent: 1, notificationId: "handoff_1" };
    },
  });
  setMock("utils/retry.js", {
    withRetry: async (fn) => fn(),
  });

  const { notifyAdminTransfer } = require(srcPath("services/whatsapp.js"));
  const result = await notifyAdminTransfer(
    "rest_1",
    "972500000000",
    "אפשר נציג?",
    "he",
    { reason: "explicit_human_request", sessionId: "session_1" }
  );

  assert.deepEqual(result, { sent: 1, notificationId: "handoff_1" });
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].restaurantId, "rest_1");
  assert.equal(telegramCalls[0].sessionId, "session_1");
  assert.equal(telegramCalls[0].customerPhone, "972500000000");
  assert.equal(telegramCalls[0].reason, "explicit_human_request");
});
