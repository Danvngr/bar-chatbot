const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function modulePath(relativeFromSrc) {
  return require.resolve(path.resolve(__dirname, "../../src", relativeFromSrc));
}

function resetModules() {
  const toClear = [
    "config/env.js",
    "config/firebase.js",
    "middleware/webhookVerify.js",
    "services/rag.js",
    "services/openai.js",
    "services/session.js",
    "services/whatsapp.js",
    "services/learning.js",
    "utils/logger.js",
    "routes/webhook.js",
  ];
  toClear.forEach((rel) => {
    const abs = modulePath(rel);
    delete require.cache[abs];
  });
}

function setMock(relativeFromSrc, exportsValue) {
  const abs = modulePath(relativeFromSrc);
  require.cache[abs] = {
    id: abs,
    filename: abs,
    loaded: true,
    exports: exportsValue,
  };
}

function createPayload(text, options = {}) {
  const phoneNumberId = options.phoneNumberId || "pn_1";
  const from = options.from || "972500000000";
  const messageId = options.messageId || `msg_${Date.now()}`;
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {
                phone_number_id: phoneNumberId,
              },
              messages: [
                {
                  id: messageId,
                  from,
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function loadWebhookHarness(options = {}) {
  resetModules();

  const sentMessages = [];
  const adminTransfers = [];
  const unanswered = [];
  const restaurantStatusUpdates = [];
  const sessionMessages = [];
  const switchedSessions = [];
  const botResumedSessions = [];
  const composeCalls = [];
  const chatCalls = [];
  const ragCalls = [];
  const claimedMessageIds = [];

  const restaurant = options.restaurant || {
    id: "rest_1",
    restaurant_id: "rest_1",
    name: "מסעדת הדגמה",
    phone_number: "0501234567",
    admin_phone: "0509999999",
    system_prompt_base: "base",
  };
  const restaurantMatches = options.restaurantMatches || [{ id: restaurant.id, data: restaurant }];

  const snapshot = restaurantMatches.length === 0
    ? { empty: true, size: 0, docs: [] }
    : {
      empty: false,
      size: restaurantMatches.length,
      docs: restaurantMatches.map((item) => ({
        id: item.id,
        data: () => item.data,
      })),
    };

  const db = {
    collection(name) {
      if (name !== "restaurants") {
        throw new Error(`Unexpected collection: ${name}`);
      }
      return {
        where() {
          return {
            limit() {
              return {
                async get() {
                  return snapshot;
                },
              };
            },
          };
        },
        doc(id) {
          return {
            async set(data, opts) {
              restaurantStatusUpdates.push({ id, data, opts });
            },
          };
        },
      };
    },
  };

  setMock("config/env.js", {
    OPENAI_API_KEY: "test-key",
    OPENAI_CHAT_MODEL: "test-model",
    WHATSAPP_VERIFY_TOKEN: "verify",
    WHATSAPP_APP_SECRET: "secret",
  });

  setMock("config/firebase.js", {
    db,
    admin: {
      firestore: {
        FieldValue: {
          serverTimestamp: () => "__ts__",
        },
      },
    },
  });

  setMock("middleware/webhookVerify.js", {
    verifyWebhookSignature: (_req, _res, next) => next(),
  });

  setMock("services/rag.js", {
    retrieveKnowledgeContext: async (restaurantId, query, ragOptions) => {
      ragCalls.push({ restaurantId, query, options: ragOptions });
      if (typeof options.retrieveKnowledgeContext === "function") {
        return options.retrieveKnowledgeContext({ restaurantId, query, options: ragOptions, callCount: ragCalls.length });
      }
      return options.ragResult || { context: "", items: [] };
    },
  });

  setMock("services/openai.js", {
    chatCompletion: async (messages, chatOptions) => {
      chatCalls.push({ messages, chatOptions });
      if (typeof options.chatCompletion === "function") {
        return options.chatCompletion(messages, chatOptions);
      }
      return options.chatReply || "תשובה רגילה";
    },
    composeResponse: async (args) => {
      composeCalls.push(args);
      if (typeof options.composeResponse === "function") {
        return options.composeResponse(args);
      }
      return `intent:${args.intent}`;
    },
    analyzeUserMessage: async (args) => {
      if (typeof options.analyzeUserMessage === "function") {
        return options.analyzeUserMessage(args);
      }
      return options.analyzeUserMessageResult || {
        intent: "unknown",
        confidence: 0,
        answer_style: "standard",
        retrieval_query: args?.message || "",
        should_use_history: false,
        should_bypass_address_flow: false,
      };
    },
  });

  setMock("services/session.js", {
    BOT_ACTIVE: "BOT_ACTIVE",
    HUMAN_ACTIVE: "HUMAN_ACTIVE",
    getOrCreateSession: async () => ({
      id: "session_1",
      status: options.sessionStatus || "BOT_ACTIVE",
      messages: options.sessionHistory || [],
    }),
    claimInboundMessage: async (_sessionId, messageId) => {
      claimedMessageIds.push(messageId);
      if (typeof options.claimInboundMessage === "function") {
        return options.claimInboundMessage(messageId);
      }
      return options.claimInboundMessageResult !== undefined ? options.claimInboundMessageResult : true;
    },
    addMessage: async (sessionId, role, content) => {
      sessionMessages.push({ sessionId, role, content });
    },
    switchToHuman: async (sessionId) => {
      switchedSessions.push(sessionId);
    },
    switchToBot: async (sessionId, metadata) => {
      botResumedSessions.push({ sessionId, metadata });
    },
  });

  setMock("services/whatsapp.js", {
    sendTextMessage: async (to, message, sendOptions) => {
      sentMessages.push({ to, message, sendOptions });
    },
    notifyAdminTransfer: async (restaurantId, customerPhone, userMessage, language, transferOptions) => {
      adminTransfers.push({ restaurantId, customerPhone, userMessage, language, transferOptions });
    },
  });

  setMock("services/learning.js", {
    logUnansweredQuestion: async (payload) => {
      unanswered.push(payload);
      return `q_${unanswered.length}`;
    },
  });

  setMock("utils/logger.js", {
    info: () => {},
    warn: () => {},
    error: () => {},
  });

  const router = require(modulePath("routes/webhook.js"));
  const processIncomingMessage = router.__test__.processIncomingMessage;

  return {
    processIncomingMessage,
    sentMessages,
    adminTransfers,
    unanswered,
    restaurantStatusUpdates,
    sessionMessages,
    switchedSessions,
    botResumedSessions,
    composeCalls,
    chatCalls,
    ragCalls,
    claimedMessageIds,
  };
}

test("explicit human request escalates and notifies admin", async () => {
  const harness = loadWebhookHarness({
    sessionHistory: [
      { role: "assistant", content: "בשמחה. לפני שאני מעביר לנציג, תוכל לכתוב בקצרה במה מדובר?", ts: Date.now() },
    ],
    composeResponse: async ({ intent }) => `intent:${intent}`,
  });

  await harness.processIncomingMessage(createPayload("אפשר נציג אנושי?"));

  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_explicit_handoff_request/);
  assert.equal(harness.adminTransfers.length, 1);
  assert.equal(harness.adminTransfers[0].transferOptions.reason, "explicit_human_request");
  assert.equal(harness.unanswered.length, 1);
});

test("first bare human request asks for context before escalation", async () => {
  const harness = loadWebhookHarness({
    composeResponse: async ({ intent }) => `intent:${intent}`,
  });

  await harness.processIncomingMessage(createPayload("אני צריך נציג"));

  assert.equal(harness.adminTransfers.length, 0);
  assert.equal(harness.unanswered.length, 0);
  assert.equal(harness.switchedSessions.length, 0);
  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_initial_handoff_clarification/);
});

test("complaint message escalates with complaint reason", async () => {
  const harness = loadWebhookHarness({
    composeResponse: async ({ intent }) => `intent:${intent}`,
  });

  await harness.processIncomingMessage(createPayload("יש לי תלונה, השירות גרוע ואני רוצה שמנהל יחזור אליי"));

  assert.equal(harness.adminTransfers.length, 1);
  assert.equal(harness.adminTransfers[0].transferOptions.reason, "complaint");
  assert.match(harness.sentMessages[0].message, /intent:customer_explicit_handoff_request/);
});

test("nudge-only question mark gets contextual follow-up without escalation", async () => {
  const harness = loadWebhookHarness({
    sessionHistory: [{ role: "user", content: "אני בן 17, אפשר להיכנס?" }],
    composeResponse: async ({ intent, hardFacts }) =>
      `intent:${intent}|prev:${hardFacts.previous_context || ""}`,
  });

  await harness.processIncomingMessage(createPayload("?"));

  assert.equal(harness.adminTransfers.length, 0);
  assert.equal(harness.unanswered.length, 0);
  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_nudge_followup/);
  assert.match(harness.sentMessages[0].message, /אני בן 17/);
});

test("hiring question without hiring fact escalates and carries business phone", async () => {
  const harness = loadWebhookHarness({
    ragResult: {
      context: "[menu] תפריט",
      items: [{ category: "menu", content: "תפריט: ...", score: 0.8 }],
    },
    composeResponse: async ({ intent, hardFacts }) =>
      `intent:${intent}|phone:${hardFacts.business_phone || ""}`,
  });

  await harness.processIncomingMessage(createPayload("אתם מגייסים עובדים עכשיו?"));

  assert.equal(harness.adminTransfers.length, 1);
  assert.equal(harness.adminTransfers[0].transferOptions.reason, "hiring_missing_info");
  assert.match(harness.sentMessages[0].message, /intent:customer_hiring_no_fact/);
  assert.match(harness.sentMessages[0].message, /phone:0501234567/);
});

test("address question with strong address fact answers directly without transfer", async () => {
  const harness = loadWebhookHarness({
    ragResult: {
      context: "[address] כתובת ומיקום מדויק: רחוב הדגמה 34",
      items: [
        { category: "address", content: "כתובת ומיקום מדויק: רחוב הדגמה 34", score: 0.41 },
      ],
    },
    composeResponse: async ({ intent, hardFacts }) =>
      `intent:${intent}|address:${hardFacts.address || ""}`,
  });

  await harness.processIncomingMessage(createPayload("איפה אתם נמצאים?"));

  assert.equal(harness.adminTransfers.length, 0);
  assert.equal(harness.unanswered.length, 0);
  assert.match(harness.sentMessages[0].message, /intent:customer_address_fact/);
  assert.match(harness.sentMessages[0].message, /address:רחוב הדגמה 34/);
});

test("menu item price question uses menu link instead of transferring", async () => {
  const harness = loadWebhookHarness({
    ragResult: {
      context: "[menu] תפריט אוכל עיקרי: https://example.com/menu",
      items: [
        { category: "menu", content: "תפריט אוכל עיקרי: https://example.com/menu", score: 0.8 },
      ],
    },
    composeResponse: async ({ intent, hardFacts }) =>
      `intent:${intent}|menu:${hardFacts.menu_link || ""}`,
  });

  await harness.processIncomingMessage(createPayload("כמה עולה כוס יין?"));

  assert.equal(harness.adminTransfers.length, 0);
  assert.equal(harness.unanswered.length, 0);
  assert.equal(harness.switchedSessions.length, 0);
  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_menu_link_fallback/);
  assert.match(harness.sentMessages[0].message, /menu:https:\/\/example\.com\/menu/);
});

test("allergy menu wording prioritizes health safety fact over menu link", async () => {
  const harness = loadWebhookHarness({
    ragResult: {
      context: [
        "[menu] תפריט אוכל עיקרי: https://example.com/menu",
        "[custom] אלרגנים: יש מנות מותאמות, אבל חייבים לעדכן את הצוות לפני הזמנה.",
      ].join("\n"),
      items: [
        { category: "menu", content: "תפריט אוכל עיקרי: https://example.com/menu", score: 0.8 },
        { category: "custom", content: "אלרגנים: יש מנות מותאמות, אבל חייבים לעדכן את הצוות לפני הזמנה.", score: 0.7 },
      ],
    },
    composeResponse: async ({ intent, hardFacts }) =>
      `intent:${intent}|health:${hardFacts.health_fact || ""}|menu:${hardFacts.menu_link || ""}`,
  });

  await harness.processIncomingMessage(createPayload("יש לכם מנות לאלרגנים?"));

  assert.equal(harness.adminTransfers.length, 0);
  assert.equal(harness.unanswered.length, 0);
  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_health_safety_fact/);
  assert.match(harness.sentMessages[0].message, /health:יש מנות מותאמות/);
  assert.doesNotMatch(harness.sentMessages[0].message, /customer_menu_link_fallback/);
});

test("menu item price question without menu link asks before transfer", async () => {
  const harness = loadWebhookHarness({
    retrieveKnowledgeContext: ({ callCount }) => {
      if (callCount === 1) {
        return { context: "", items: [] };
      }
      return {
        context: "[menu] תפריט אוכל עיקרי: https://example.com/menu",
        items: [
          { category: "menu", content: "תפריט אוכל עיקרי: https://example.com/menu", score: 0.8 },
        ],
      };
    },
    composeResponse: async ({ intent, hardFacts }) =>
      `intent:${intent}|menu:${hardFacts.menu_link || ""}`,
  });

  await harness.processIncomingMessage(createPayload("כמה עולה כוס יין?"));

  assert.equal(harness.adminTransfers.length, 0);
  assert.equal(harness.unanswered.length, 0);
  assert.equal(harness.switchedSessions.length, 0);
  assert.equal(harness.ragCalls.length, 2);
  assert.match(harness.ragCalls[1].query, /תפריט/);
  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_menu_link_fallback/);
  assert.match(harness.sentMessages[0].message, /menu:https:\/\/example\.com\/menu/);
});

test("menu item price question without any menu link asks before transfer", async () => {
  const harness = loadWebhookHarness({
    retrieveKnowledgeContext: () => ({ context: "", items: [] }),
    composeResponse: async ({ intent }) => `intent:${intent}`,
  });

  await harness.processIncomingMessage(createPayload("כמה עולה כוס יין?"));

  assert.equal(harness.adminTransfers.length, 0);
  assert.equal(harness.unanswered.length, 1);
  assert.equal(harness.switchedSessions.length, 0);
  assert.equal(harness.ragCalls.length, 2);
  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_missing_menu_detail_offer_handoff/);
});

test("customer confirmation after missing menu detail transfers to human", async () => {
  const harness = loadWebhookHarness({
    sessionHistory: [
      {
        role: "assistant",
        content: "אין לי כרגע מידע מדויק על הפריט הזה בתפריט שלנו. תרצה שאעביר את השאלה לנציג מהצוות?",
      },
      { role: "user", content: "כמה עולה כוס יין?" },
    ],
    composeResponse: async ({ intent }) => `intent:${intent}`,
  });

  await harness.processIncomingMessage(createPayload("כן"));

  assert.equal(harness.adminTransfers.length, 1);
  assert.equal(harness.adminTransfers[0].transferOptions.reason, "explicit_human_request");
  assert.equal(harness.unanswered.length, 1);
  assert.equal(harness.switchedSessions.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_accepted_handoff_offer/);
});

test("semantic place-identity understanding answers minimally without address extras", async () => {
  const harness = loadWebhookHarness({
    restaurant: {
      id: "rest_1",
      restaurant_id: "rest_1",
      name: "מסעדת הדגמה",
      phone_number: "0501234567",
      admin_phone: "0509999999",
      system_prompt_base: "base",
    },
    analyzeUserMessageResult: {
      intent: "place_identity",
      confidence: 0.93,
      answer_style: "minimal",
      retrieval_query: "לאן הגעתי",
      should_use_history: false,
      should_bypass_address_flow: true,
    },
    ragResult: {
      context: "[address] כתובת: רחוב הדגמה 36. יש הרבה חניה באזור.",
      items: [
        { category: "address", content: "כתובת: רחוב הדגמה 36. יש הרבה חניה באזור.", score: 0.75 },
      ],
    },
    composeResponse: async ({ intent, hardFacts }) => `intent:${intent}|place:${hardFacts.place_name || ""}`,
  });

  await harness.processIncomingMessage(createPayload("לאן הגעתי"));

  assert.equal(harness.adminTransfers.length, 0);
  assert.equal(harness.unanswered.length, 0);
  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_place_identity_confirmation/);
  assert.match(harness.sentMessages[0].message, /place:מסעדת הדגמה/);
  assert.doesNotMatch(harness.sentMessages[0].message, /customer_address_fact/);
});

test("human-active session waits for representative without normal bot answer", async () => {
  const harness = loadWebhookHarness({
    sessionStatus: "HUMAN_ACTIVE",
    composeResponse: async ({ intent }) => `intent:${intent}`,
  });

  await harness.processIncomingMessage(createPayload("יש עוד שאלה כללית"));

  assert.equal(harness.botResumedSessions.length, 0);
  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_human_active_wait/);
});

test("human-active session resumes bot when customer explicitly asks", async () => {
  const harness = loadWebhookHarness({
    sessionStatus: "HUMAN_ACTIVE",
    composeResponse: async ({ intent }) => `intent:${intent}`,
  });

  await harness.processIncomingMessage(createPayload("אפשר להמשיך עם הבוט?"));

  assert.equal(harness.botResumedSessions.length, 1);
  assert.equal(harness.botResumedSessions[0].sessionId, "session_1");
  assert.equal(harness.botResumedSessions[0].metadata.reason, "customer_requested_bot_resume");
  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message, /intent:customer_requested_bot_resume/);
});

test("duplicate message replay is skipped by session guard", async () => {
  const seen = new Set();
  const harness = loadWebhookHarness({
    claimInboundMessage: (messageId) => {
      if (seen.has(messageId)) return false;
      seen.add(messageId);
      return true;
    },
    composeResponse: async ({ intent }) => `intent:${intent}`,
  });

  const payload = createPayload("מה היתרון שלך", { messageId: "wamid.dup.1" });
  await harness.processIncomingMessage(payload);
  await harness.processIncomingMessage(payload);

  assert.equal(harness.claimedMessageIds.length, 2);
  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sessionMessages.filter((item) => item.role === "user").length, 1);
});

test("generic unresolved flow escalates with unresolved reason", async () => {
  const harness = loadWebhookHarness({
    ragResult: { context: "[custom] משהו", items: [] },
    chatReply: "TRANSFER_TO_HUMAN",
    composeResponse: async ({ intent }) => `intent:${intent}`,
  });

  await harness.processIncomingMessage(createPayload("שאלה שאין עליה תשובה"));

  assert.equal(harness.adminTransfers.length, 1);
  assert.equal(harness.adminTransfers[0].transferOptions.reason, "unresolved");
  assert.match(harness.sentMessages[0].message, /intent:transfer_to_human/);
  assert.equal(harness.unanswered.length, 1);
  assert.equal(harness.switchedSessions.length >= 1, true);
});

test("allergy question without strong health fact escalates safely", async () => {
  const harness = loadWebhookHarness({
    ragResult: {
      context: "[custom] תפריט",
      items: [{ category: "menu", content: "תפריט: ...", score: 0.8 }],
    },
    composeResponse: async ({ intent }) => `intent:${intent}`,
  });

  await harness.processIncomingMessage(createPayload("יש לכם משהו בטוח לאלרגיה לבוטנים?"));

  assert.equal(harness.adminTransfers.length, 1);
  assert.equal(harness.adminTransfers[0].transferOptions.reason, "missing_critical_fact");
  assert.match(harness.sentMessages[0].message, /intent:customer_health_safety_missing_fact/);
});

test("allergy question with strong health fact answers directly", async () => {
  const harness = loadWebhookHarness({
    ragResult: {
      context: "[custom] אלרגיות: בודקים מול מטבח לפני אישור סופי",
      items: [{ category: "custom", content: "אלרגיות: בודקים מול מטבח לפני אישור סופי", score: 0.41 }],
    },
    composeResponse: async ({ intent, hardFacts }) => `intent:${intent}|health:${hardFacts.health_fact || ""}`,
  });

  await harness.processIncomingMessage(createPayload("אני עם צליאק, איך אתם עובדים?"));

  assert.equal(harness.adminTransfers.length, 0);
  assert.match(harness.sentMessages[0].message, /intent:customer_health_safety_fact/);
  assert.match(harness.sentMessages[0].message, /health:בודקים מול מטבח לפני אישור סופי/);
});

