const express = require("express");
const { onboardingSchema } = require("../validators/schemas");
const { provisionRestaurant } = require("../services/provisioning");
const logger = require("../utils/logger");

const router = express.Router();

router.post("/", async (req, res) => {
  const { error, value } = onboardingSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    await provisionRestaurant(value);
    return res.status(201).json({ message: "Restaurant provisioned successfully" });
  } catch (err) {
    logger.error("Provisioning failed", { error: err.message });
    return res.status(500).json({ error: "Provisioning failed" });
  }
});

module.exports = router;
