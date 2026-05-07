const express = require("express");
const env = require("../config/env");
const { verifyAdminWebhookSignature } = require("../middleware/webhookVerify");
const { safeProcessAdminMessage } = require("../services/adminBot");
const logger = require("../utils/logger");

const router = express.Router();
const recentlyProcessed = new Map();
const DEDUPE_TTL_MS = 30_000;

function dedupeCleanup() {
  const now = Date.now();
  for (const [key, ts] of recentlyProcessed) {
    if (now - ts > DEDUPE_TTL_MS) {
      recentlyProcessed.delete(key);
    }
  }
}
setInterval(dedupeCleanup, 60_000);

function extractAdminMessage(payload) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message) {
    return null;
  }
  if (message.type === "text") {
    return {
      messageId: message.id || null,
      adminPhone: message.from,
      text: message.text?.body?.trim() || "",
    };
  }
  if (message.type === "interactive" && message.interactive?.type === "button_reply") {
    return {
      messageId: message.id || null,
      adminPhone: message.from,
      text: message.interactive.button_reply.id || message.interactive.button_reply.title || "",
    };
  }
  return null;
}

router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const verifyToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const expectedToken = env.ADMIN_WHATSAPP_VERIFY_TOKEN || env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && verifyToken === expectedToken) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send("Verification failed");
});

router.post("/", verifyAdminWebhookSignature, (req, res) => {
  res.status(200).send("OK");
  const parsed = extractAdminMessage(req.body);
  if (!parsed || !parsed.text) {
    return;
  }
  if (parsed.messageId) {
    if (recentlyProcessed.has(parsed.messageId)) {
      logger.info("Duplicate admin message skipped", { messageId: parsed.messageId });
      return;
    }
    recentlyProcessed.set(parsed.messageId, Date.now());
  }
  safeProcessAdminMessage(parsed).catch((error) => {
    logger.error("Async admin webhook processing failed", { error: error.message });
  });
});

module.exports = router;
