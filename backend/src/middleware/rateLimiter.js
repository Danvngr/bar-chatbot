const rateLimit = require("express-rate-limit");
const env = require("../config/env");

const webhookRateLimiter = rateLimit({
  windowMs: Number(env.RATE_LIMIT_WINDOW_MS),
  max: Number(env.RATE_LIMIT_MAX_WEBHOOK),
  standardHeaders: true,
  legacyHeaders: false,
});

const adminRateLimiter = rateLimit({
  windowMs: Number(env.RATE_LIMIT_WINDOW_MS),
  max: Number(env.RATE_LIMIT_MAX_ADMIN),
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { webhookRateLimiter, adminRateLimiter };
