const fs = require("fs/promises");
const path = require("path");

function modulePath(relativeFromSrc) {
  return require.resolve(path.resolve(__dirname, "../src", relativeFromSrc));
}

function resetModules() {
  const toClear = [
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
  const messageId = options.messageId || `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
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

function buildQuestionFallback(topic) {
  const clean = String(topic || "").trim();
  if (!clean) return "יש לי שאלה כללית על המקום.";
  if (/^\s*האם\s+/u.test(clean) || /\?\s*$/.test(clean)) return clean.replace(/\?\s*$/, "") + "?";
  return `מה אפשר לספר לי לגבי ${clean}?`;
}

const CUSTOMER_QUESTION_BY_KEY = {
  hours: "מה שעות הפעילות שלכם היום?",
  holiday_hours: "בחגים אתם פתוחים כרגיל?",
  address: "מה הכתובת שלכם?",
  navigation_link: "אפשר לקבל קישור לניווט?",
  parking_enabled: "יש חניה נוחה ליד המקום?",
  parking: "איפה הכי נוח לחנות כשמגיעים אליכם?",
  accessibility_enabled: "יש אצלכם נגישות?",
  accessibility: "איזה נגישות יש במקום?",
  seating_areas: "יש ישיבה בפנים או גם בחוץ?",
  seating_climate: "אם יושבים בחוץ, יש קירוי או חימום?",
  baby_changing: "יש פינת החתלה בשירותים?",
  medical_kit: "אם יש מצב חירום או אלרגיה, יש אצלכם מענה במקום?",
  kosher_enabled: "יש לכם כשרות?",
  kosher: "איזו כשרות יש לכם?",
  wifi_enabled: "יש אצלכם וויי-פיי ללקוחות?",
  wifi: "מה פרטי ה-Wi-Fi אצלכם?",
  menu_main: "אפשר לקבל קצת מידע על התפריט שלכם?",
  has_dessert_menu: "יש לכם תפריט קינוחים?",
  menu_dessert: "מה יש אצלכם בקינוחים?",
  kids_menu_enabled: "יש אצלכם תפריט ילדים?",
  kids_menu: "מה יש אצלכם בתפריט ילדים?",
  alcohol_menu_enabled: "יש אצלכם תפריט אלכוהול?",
  alcohol_menu: "מה יש אצלכם בתפריט האלכוהול?",
  business_lunch_brunch: "יש אצלכם עסקיות צהריים או בראנץ'?",
  vegan_vegetarian: "יש אצלכם אופציות טבעוניות או צמחוניות?",
  gluten_free: "יש אצלכם מנות ללא גלוטן?",
  allergy_info: "יש משהו שחשוב לדעת אצלכם לגבי אלרגנים?",
  milk_types: "יש אצלכם סוגי חלב נוספים לקפה?",
  deliveries_enabled: "יש לכם משלוחים?",
  deliveries_details: "איך המשלוחים אצלכם עובדים?",
  deliveries_tracking: "איך עוקבים אצלכם אחרי משלוח?",
  reservation_enabled: "אפשר להזמין אצלכם שולחן מראש?",
  reservation: "איך מזמינים אצלכם שולחן?",
  large_group_reservation: "אם רוצים להגיע קבוצה גדולה, איך סוגרים את זה?",
  cancellation_fee: "יש אצלכם דמי ביטול או מינימום להזמנה?",
  reservation_deposit: "צריך להשאיר אשראי או פיקדון להזמנה?",
  payment: "איך אפשר לשלם אצלכם?",
  cibus_10bis: "אתם עובדים עם סיבוס או תן ביס?",
  promotions: "יש אצלכם מבצעים קבועים?",
  happy_hour: "יש אצלכם האפי האוור?",
  customer_club_enabled: "יש לכם מועדון לקוחות?",
  customer_club: "איך מצטרפים אצלכם למועדון לקוחות?",
  discounts: "יש אצלכם הנחות מיוחדות?",
  birthday_benefits: "יש אצלכם הטבה ליום הולדת?",
  specials: "יש אצלכם ספיישלים קבועים?",
  gift_cards_enabled: "אפשר לשלם אצלכם עם BuyMe או גיפט קארד?",
  gift_cards: "איך עובד אצלכם גיפט קארד או BuyMe?",
  inhouse_events_enabled: "יש אצלכם אירועים קבועים במקום?",
  inhouse_events: "איזה אירועים בדרך כלל יש אצלכם?",
  inhouse_events_entry_fee: "יש אצלכם לפעמים תשלום כניסה לאירועים?",
  inhouse_events_guidelines: "יש הנחיות מיוחדות לאירועים אצלכם?",
  private_events_enabled: "אפשר לעשות אצלכם אירוע פרטי?",
  private_events: "איזה אירועים פרטיים אפשר לעשות אצלכם?",
  sports_broadcasts_enabled: "אתם משדרים אצלכם ספורט במקום?",
  sports_broadcasts: "איזה משחקים או שידורי ספורט יש אצלכם בדרך כלל?",
  music_enabled: "יש אצלכם מוזיקה קבועה או די-ג'יי?",
  music_style: "איזה סגנון מוזיקה יש אצלכם בדרך כלל?",
  age_restriction: "יש אצלכם גיל כניסה?",
  smoking_policy: "מה מדיניות העישון אצלכם?",
  dress_code: "יש אצלכם קוד לבוש?",
  chaser_deals: "יש אצלכם מבצעי צ'ייסרים או בקבוקים?",
  corkage_fee: "יש אצלכם דמי חליצה?",
  merchandise_enabled: "יש אצלכם מרצ'נדייז למכירה?",
  merchandise: "איזה מרצ'נדייז אפשר לקנות אצלכם?",
  lost_found_enabled: "יש אצלכם נוהל אבדות ומציאות?",
  lost_found: "אם שכחתי משהו אצלכם, איך פונים?",
  security_enabled: "יש אצלכם אבטחה או מצלמות במקום?",
  security: "מה חשוב לדעת לגבי אבטחה אצלכם?",
  hiring_enabled: "אתם מגייסים עובדים כרגע?",
  hiring: "לאילו תפקידים אתם מגייסים ואיך מגישים אצלכם מועמדות?",
  human_representative: "אם אני רוצה לדבר עם נציג אנושי, איך עושים את זה?",
  receipt_feedback: "אם אני צריך העתק קבלה או רוצה להשאיר תלונה, איך פונים אצלכם?",
};

function questionForTopic(topic) {
  return CUSTOMER_QUESTION_BY_KEY[topic.key] || buildQuestionFallback(topic.topic || topic.text || topic.key);
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function pickRestaurant(restaurantsRef, explicitRestaurantId) {
  if (explicitRestaurantId) {
    const snap = await restaurantsRef.doc(explicitRestaurantId).get();
    if (!snap.exists) {
      throw new Error(`Restaurant not found: ${explicitRestaurantId}`);
    }
    return { id: snap.id, ...snap.data() };
  }

  const snap = await restaurantsRef.get();
  const restaurants = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const counts = new Map();
  restaurants.forEach((restaurant) => {
    const phoneId = String(restaurant.whatsapp_phone_number_id || "").trim();
    if (!phoneId) return;
    counts.set(phoneId, (counts.get(phoneId) || 0) + 1);
  });

  const candidate = restaurants.find((restaurant) => {
    const phoneId = String(restaurant.whatsapp_phone_number_id || "").trim();
    return phoneId && counts.get(phoneId) === 1;
  });

  if (!candidate) {
    throw new Error("Could not auto-pick restaurant with unique whatsapp_phone_number_id. Pass a restaurant id explicitly.");
  }
  return candidate;
}

function loadWebhookHarness() {
  resetModules();

  const sentMessages = [];
  const adminTransfers = [];
  const unanswered = [];
  const sessionStore = new Map();

  setMock("services/session.js", {
    BOT_ACTIVE: "BOT_ACTIVE",
    HUMAN_ACTIVE: "HUMAN_ACTIVE",
    getOrCreateSession: async (phoneNumber, restaurantId) => {
      const id = `${phoneNumber}_${restaurantId}`;
      if (!sessionStore.has(id)) {
        sessionStore.set(id, {
          id,
          status: "BOT_ACTIVE",
          messages: [],
        });
      }
      return sessionStore.get(id);
    },
    addMessage: async (sessionId, role, content) => {
      const current = sessionStore.get(sessionId);
      if (!current) return;
      current.messages = [...(current.messages || []), { role, content }].slice(-15);
    },
    switchToHuman: async (sessionId) => {
      const current = sessionStore.get(sessionId);
      if (!current) return;
      current.status = "HUMAN_ACTIVE";
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
  return {
    processIncomingMessage: router.__test__.processIncomingMessage,
    sentMessages,
    adminTransfers,
    unanswered,
  };
}

async function main() {
  const explicitRestaurantId = process.argv[2] ? String(process.argv[2]).trim() : "";
  const questionTimeoutMs = Number(process.env.TOPIC_SWEEP_TIMEOUT_MS || 45000);
  const { db } = require("../src/config/firebase");
  const { resolveTopicQuestions } = require("../src/services/onboardingFlow");

  const restaurant = await pickRestaurant(db.collection("restaurants"), explicitRestaurantId);
  const phoneNumberId = String(restaurant.whatsapp_phone_number_id || "").trim();
  if (!phoneNumberId) {
    throw new Error(`Restaurant ${restaurant.id} has no whatsapp_phone_number_id`);
  }

  const topics = resolveTopicQuestions();
  const harness = loadWebhookHarness();
  const results = [];

  console.log(`Running topic sweep for ${restaurant.name || restaurant.id} (${restaurant.id})`);
  console.log(`Testing ${topics.length} topics with timeout ${questionTimeoutMs}ms per topic`);

  for (let i = 0; i < topics.length; i += 1) {
    const topic = topics[i];
    const question = questionForTopic(topic);
    const customerPhone = `97250000${String(1000 + i).padStart(4, "0")}`;
    const beforeSent = harness.sentMessages.length;
    const beforeTransfers = harness.adminTransfers.length;
    console.log(`[${i + 1}/${topics.length}] ${topic.key} -> ${question}`);

    let errorText = "";
    try {
      await withTimeout(
        harness.processIncomingMessage(
          createPayload(question, {
            phoneNumberId,
            from: customerPhone,
            messageId: `topic_${i}_${Date.now()}`,
          })
        ),
        questionTimeoutMs,
        topic.key
      );
    } catch (error) {
      errorText = error.message || String(error);
    }

    const sent = harness.sentMessages.slice(beforeSent);
    const transfers = harness.adminTransfers.slice(beforeTransfers);
    results.push({
      key: topic.key,
      topic: topic.topic || topic.text || topic.key,
      question,
      answer: errorText
        ? `ERROR: ${errorText}`
        : (sent.map((item) => item.message).join("\n---\n") || "(לא נשלחה תשובה)"),
      escalated: transfers.length > 0,
      escalationReason: transfers[0]?.transferOptions?.reason || "",
    });
  }

  const lines = [
    `# Topic Sweep Report`,
    ``,
    `Restaurant: ${restaurant.name || restaurant.id}`,
    `Restaurant ID: ${restaurant.id}`,
    `Phone Number ID: ${phoneNumberId}`,
    `Topics tested: ${results.length}`,
    `Generated at: ${new Date().toISOString()}`,
    ``,
  ];

  results.forEach((result, index) => {
    lines.push(`## ${index + 1}. ${result.topic}`);
    lines.push(`- Key: \`${result.key}\``);
    lines.push(`- Question: ${result.question}`);
    lines.push(`- Escalated: ${result.escalated ? "yes" : "no"}${result.escalationReason ? ` (\`${result.escalationReason}\`)` : ""}`);
    lines.push(`- Answer:`);
    lines.push("");
    lines.push("```text");
    lines.push(result.answer || "");
    lines.push("```");
    lines.push("");
  });

  const reportPath = path.resolve(__dirname, "../topic-sweep-latest.md");
  await fs.writeFile(reportPath, lines.join("\n"), "utf8");

  console.log(JSON.stringify({
    restaurantId: restaurant.id,
    restaurantName: restaurant.name || restaurant.id,
    topicsTested: results.length,
    escalations: results.filter((result) => result.escalated).length,
    reportPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
