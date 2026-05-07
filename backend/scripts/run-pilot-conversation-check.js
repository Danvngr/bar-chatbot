#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_QUESTIONS = [
  "היי, מה השעות שלכם היום?",
  "איפה אתם נמצאים?",
  "איך מגיעים אליכם?",
  "יש תפריט?",
  "כמה עולה כוס יין?",
  "יש לכם פסטה?",
  "איך מזמינים מקום?",
  "יש חניה?",
  "אתם כשרים?",
  "יש כשרות מהדרין?",
  "יש לכם מנות ללא גלוטן?",
  "אני אלרגי לבוטנים, אפשר לאכול אצלכם?",
  "יש משלוחים?",
  "יש אירועים השבוע?",
  "כמה עולה כניסה?",
  "אפשר לבוא עם 20 אנשים?",
  "אתם מגייסים עובדים?",
  "אפשר לדבר עם נציג?",
  "יש לי תלונה",
  "לאן הגעתי?",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/run-pilot-conversation-check.js --restaurant-id <id>",
    "  node scripts/run-pilot-conversation-check.js --phone-number-id <whatsapp_phone_number_id>",
    "",
    "Optional:",
    "  --questions <path>      JSON array or text file with one question per line",
    "  --out <path>            Output markdown path (default: pilot-results.md)",
    "  --conversation          Keep one continuous in-memory session instead of resetting per question",
    "",
    "Example:",
    "  node scripts/run-pilot-conversation-check.js --restaurant-id <your_restaurant_id> --out pilot-results.md",
  ].join("\n");
}

function readQuestions(filePath) {
  if (!filePath) return DEFAULT_QUESTIONS;
  const abs = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Questions JSON must be an array of strings");
    }
    return parsed.map((q) => String(q || "").trim()).filter(Boolean);
  }
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function modulePath(relativeFromSrc) {
  return require.resolve(path.resolve(__dirname, "../src", relativeFromSrc));
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

function createPayload({ text, phoneNumberId, from, messageId }) {
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

async function resolvePhoneNumberId({ restaurantId, phoneNumberId }) {
  if (phoneNumberId) return phoneNumberId;
  if (!restaurantId) {
    throw new Error("Missing --restaurant-id or --phone-number-id");
  }
  const { db } = require("../src/config/firebase");
  const snap = await db.collection("restaurants").doc(restaurantId).get();
  if (!snap.exists) {
    throw new Error(`Restaurant not found: ${restaurantId}`);
  }
  const restaurant = snap.data();
  const resolved = String(restaurant.whatsapp_phone_number_id || "").trim();
  if (!resolved) {
    throw new Error(`Restaurant ${restaurantId} has no whatsapp_phone_number_id`);
  }
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  const questions = readQuestions(args.questions);
  if (questions.length === 0) {
    throw new Error("No questions to run");
  }

  const phoneNumberId = await resolvePhoneNumberId({
    restaurantId: args["restaurant-id"],
    phoneNumberId: args["phone-number-id"],
  });
  const outPath = path.resolve(process.cwd(), args.out || "pilot-results.md");
  const keepConversation = Boolean(args.conversation);
  const from = String(args.from || "972500000999");

  const sentMessages = [];
  const transfers = [];
  const unanswered = [];
  const session = {
    id: `pilot_${from}_${Date.now()}`,
    status: "BOT_ACTIVE",
    messages: [],
  };

  setMock("services/whatsapp.js", {
    sendTextMessage: async (to, message, options) => {
      sentMessages.push({ to, message, options });
      return { dryRun: true };
    },
    sendAdminTextMessage: async () => ({ dryRun: true }),
    notifyAdminTransfer: async (restaurantId, customerPhone, userMessage, language, options) => {
      transfers.push({ restaurantId, customerPhone, userMessage, language, options });
      return { dryRun: true };
    },
    sendInteractiveButtons: async () => ({ dryRun: true }),
  });

  setMock("services/learning.js", {
    logUnansweredQuestion: async (payload) => {
      unanswered.push(payload);
      return `dry_${unanswered.length}`;
    },
  });

  setMock("services/session.js", {
    BOT_ACTIVE: "BOT_ACTIVE",
    HUMAN_ACTIVE: "HUMAN_ACTIVE",
    getOrCreateSession: async () => ({ ...session, messages: [...session.messages] }),
    claimInboundMessage: async () => true,
    addMessage: async (_sessionId, role, content) => {
      session.messages = [...session.messages, { role, content, ts: Date.now() }].slice(-15);
    },
    switchToHuman: async (_sessionId, metadata = {}) => {
      session.status = "HUMAN_ACTIVE";
      session.human_handoff_reason = metadata.reason || "";
    },
    switchToBot: async () => {
      session.status = "BOT_ACTIVE";
    },
  });

  const router = require("../src/routes/webhook");
  const processIncomingMessage = router.__test__.processIncomingMessage;
  const results = [];

  for (let index = 0; index < questions.length; index += 1) {
    if (!keepConversation) {
      session.status = "BOT_ACTIVE";
      session.messages = [];
      session.human_handoff_reason = "";
    }

    const beforeSent = sentMessages.length;
    const beforeTransfers = transfers.length;
    const beforeUnanswered = unanswered.length;
    const question = questions[index];

    await processIncomingMessage(createPayload({
      text: question,
      phoneNumberId,
      from,
      messageId: `pilot_${index + 1}_${Date.now()}`,
    }));

    results.push({
      index: index + 1,
      question,
      answers: sentMessages.slice(beforeSent).map((item) => item.message),
      transfers: transfers.slice(beforeTransfers),
      unanswered: unanswered.slice(beforeUnanswered),
      sessionStatus: session.status,
    });
  }

  const lines = [
    "# Pilot Conversation Check",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Questions: ${results.length}`,
    `Mode: ${keepConversation ? "continuous conversation" : "isolated questions"}`,
    `Phone number ID: ${phoneNumberId}`,
    "",
  ];

  for (const result of results) {
    lines.push(`## ${result.index}. ${result.question}`);
    lines.push("");
    if (result.answers.length === 0) {
      lines.push("_No bot answer captured._");
    } else {
      result.answers.forEach((answer, answerIdx) => {
        lines.push(answerIdx === 0 ? "**Bot answer:**" : `**Bot answer ${answerIdx + 1}:**`);
        lines.push("");
        lines.push("```text");
        lines.push(answer);
        lines.push("```");
      });
    }
    if (result.transfers.length > 0) {
      lines.push("");
      lines.push(`**Transfer:** yes (${result.transfers.map((t) => t.options?.reason || "unknown").join(", ")})`);
    }
    if (result.unanswered.length > 0) {
      lines.push("");
      lines.push("**Logged as unanswered:** yes");
    }
    lines.push("");
  }

  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${results.length} results to ${outPath}`);
}

main().catch((error) => {
  console.error(error.message);
  console.error("");
  console.error(usage());
  process.exitCode = 1;
});
