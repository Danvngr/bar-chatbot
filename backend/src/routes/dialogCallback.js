const express = require("express");
const env = require("../config/env");
const { savePendingConnection } = require("../services/dialogLink");
const logger = require("../utils/logger");

const router = express.Router();

function getToken(req) {
  return String(req.headers["x-dialog-callback-token"] || req.query.token || req.body?.token || "").trim();
}

function pickPhoneNumberId(body) {
  const candidates = [
    body?.phone_number_id,
    body?.phoneNumberId,
    body?.data?.phone_number_id,
    body?.data?.phoneNumberId,
  ];
  return String(candidates.find((v) => String(v || "").trim()) || "").trim();
}

function pickAdminPhone(body) {
  const candidates = [
    body?.admin_phone,
    body?.adminPhone,
    body?.metadata?.admin_phone,
    body?.metadata?.adminPhone,
    body?.state?.admin_phone,
  ];
  return String(candidates.find((v) => String(v || "").trim()) || "").trim();
}

function pickInviteCode(body) {
  const candidates = [
    body?.invite_code,
    body?.inviteCode,
    body?.metadata?.invite_code,
    body?.metadata?.inviteCode,
    body?.state?.invite_code,
  ];
  return String(candidates.find((v) => String(v || "").trim()) || "").trim();
}

router.post("/", async (req, res) => {
  if (!env.DIALOG_INTEGRATION_ENABLED) {
    return res.status(503).json({ error: "Dialog integration is disabled" });
  }

  const configuredToken = String(env.DIALOG_CALLBACK_TOKEN || "").trim();
  if (configuredToken) {
    const incomingToken = getToken(req);
    if (!incomingToken || incomingToken !== configuredToken) {
      return res.status(403).json({ error: "Invalid callback token" });
    }
  }

  const phoneNumberId = pickPhoneNumberId(req.body);
  const adminPhone = pickAdminPhone(req.body);
  const inviteCode = pickInviteCode(req.body);

  if (!phoneNumberId || !adminPhone) {
    return res.status(400).json({ error: "Missing adminPhone or phoneNumberId" });
  }

  try {
    await savePendingConnection({
      adminPhone,
      inviteCode,
      phoneNumberId,
      payload: req.body || {},
    });
    return res.json({ ok: true });
  } catch (error) {
    logger.error("Dialog callback failed", { error: error.message });
    return res.status(500).json({ error: "Failed to save dialog connection" });
  }
});

module.exports = router;
