const express = require("express");
const env = require("../config/env");
const { createInviteCode } = require("../services/inviteCodes");
const { sendAdminTextMessage } = require("../services/whatsapp");
const { attachInviteCodeToLead } = require("../services/leadStore");
const logger = require("../utils/logger");

const router = express.Router();

function requireInternalKey(req, res, next) {
  const configuredKey = String(env.INTERNAL_API_KEY || "").trim();
  if (!configuredKey) {
    return res.status(503).json({ error: "Internal API key is not configured" });
  }

  const provided = String(req.headers["x-internal-api-key"] || "").trim();
  if (!provided || provided !== configuredKey) {
    return res.status(403).json({ error: "Invalid internal API key" });
  }

  return next();
}

router.post("/", requireInternalKey, async (req, res) => {
  const customCode = typeof req.body?.code === "string" ? req.body.code : null;
  const sendToPhone = String(req.body?.sendToPhone || "").trim();

  try {
    const code = await createInviteCode(customCode);

    if (sendToPhone) {
      const message = [
        `קוד ההזמנה שלך: ${code}`,
        "שלח את הקוד הזה לבוט המנהל כדי להתחיל בהקמה.",
      ].join("\n");
      await sendAdminTextMessage(sendToPhone, message);
      await attachInviteCodeToLead({ phone: sendToPhone, inviteCode: code });
    }

    return res.status(201).json({ code });
  } catch (error) {
    logger.error("Create invite code API failed", { error: error.message });
    return res.status(500).json({ error: "Failed to create invite code" });
  }
});

module.exports = router;
