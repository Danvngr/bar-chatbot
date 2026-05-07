const express = require("express");
const env = require("../config/env");
const { updateRestaurantWhatsAppNumber } = require("../services/dialogLink");
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

router.patch("/:restaurantId/whatsapp-number", requireInternalKey, async (req, res) => {
  const restaurantId = String(req.params?.restaurantId || "").trim();
  const phoneNumberId = String(req.body?.phone_number_id || "").trim();

  if (!restaurantId || !phoneNumberId) {
    return res.status(400).json({ error: "Missing restaurantId or phone_number_id" });
  }

  try {
    await updateRestaurantWhatsAppNumber({ restaurantId, phoneNumberId });
    return res.json({ ok: true });
  } catch (error) {
    logger.error("Manual restaurant WhatsApp update failed", { error: error.message });
    return res.status(500).json({ error: "Failed to update restaurant phone number" });
  }
});

module.exports = router;
