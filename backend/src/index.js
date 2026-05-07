const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const env = require("./config/env");
require("./config/firebase");

const { webhookRateLimiter, adminRateLimiter } = require("./middleware/rateLimiter");
const { requireAuth } = require("./middleware/auth");
const webhookRoutes = require("./routes/webhook");
const adminWebhookRoutes = require("./routes/adminWebhook");
const adminRoutes = require("./routes/admin");
const onboardingRoutes = require("./routes/onboarding");
const dialogCallbackRoutes = require("./routes/dialogCallback");
const telegramRoutes = require("./routes/telegram");
const inviteCodesApiRoutes = require("./routes/inviteCodesApi");
const restaurantsApiRoutes = require("./routes/restaurantsApi");
const { startKnowledgeExpiryCleanupJob } = require("./services/knowledgeExpiry");
const { startSessionTimeoutJob } = require("./services/sessionTimeout");
const logger = require("./utils/logger");

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(morgan("combined"));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/webhook", webhookRateLimiter, webhookRoutes);
app.use("/admin-webhook", webhookRateLimiter, adminWebhookRoutes);
app.use("/dialog-callback", webhookRateLimiter, dialogCallbackRoutes);
app.use("/telegram-webhook", webhookRateLimiter, telegramRoutes);
app.use("/api/onboarding", adminRateLimiter, requireAuth, onboardingRoutes);
app.use("/api/admin", adminRateLimiter, requireAuth, adminRoutes);
app.use("/api/invite-codes", adminRateLimiter, inviteCodesApiRoutes);
app.use("/api/restaurants", adminRateLimiter, restaurantsApiRoutes);

app.use((err, _req, res, _next) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

app.listen(env.PORT, () => {
  logger.info(`Server listening on ${env.PORT}`);
  startKnowledgeExpiryCleanupJob();
  startSessionTimeoutJob();
});
