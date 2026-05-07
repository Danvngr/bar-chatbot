const dotenv = require("dotenv");
const Joi = require("joi");

dotenv.config();

const schema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
  PORT: Joi.number().default(3000),
  LOG_LEVEL: Joi.string().default("info"),
  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().required(),
  FIREBASE_PRIVATE_KEY: Joi.string().required(),
  OPENAI_API_KEY: Joi.string().required(),
  ADMIN_OPENAI_API_KEY: Joi.string().allow("").optional(),
  OPENAI_EMBEDDING_MODEL: Joi.string().default("text-embedding-3-small"),
  OPENAI_CHAT_MODEL: Joi.string().default("gpt-4o-mini"),
  ADMIN_OPENAI_CHAT_MODEL: Joi.string().default("gpt-4o"),
  WHATSAPP_VERIFY_TOKEN: Joi.string().required(),
  WHATSAPP_APP_SECRET: Joi.string().required(),
  WHATSAPP_ACCESS_TOKEN: Joi.string().required(),
  WHATSAPP_PHONE_NUMBER_ID: Joi.string().required(),
  WHATSAPP_API_VERSION: Joi.string().default("v21.0"),
  ADMIN_WHATSAPP_VERIFY_TOKEN: Joi.string().allow("").optional(),
  ADMIN_WHATSAPP_APP_SECRET: Joi.string().allow("").optional(),
  ADMIN_WHATSAPP_ACCESS_TOKEN: Joi.string().allow("").optional(),
  ADMIN_WHATSAPP_PHONE_NUMBER_ID: Joi.string().allow("").optional(),
  ADMIN_AUTH_TTL_MINUTES: Joi.number().default(5),
  ADMIN_SESSION_IDLE_TIMEOUT_MINUTES: Joi.number().default(10),
  ADMIN_MAX_MESSAGE_CHARS: Joi.number().default(1200),
  ADMIN_LOGIN_MAX_FAILURES: Joi.number().default(3),
  ADMIN_LOGIN_LOCK_MINUTES: Joi.number().default(10),
  ADMIN_LOGIN_MIN_INTERVAL_SECONDS: Joi.number().default(2),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(60000),
  RATE_LIMIT_MAX_WEBHOOK: Joi.number().default(100),
  RATE_LIMIT_MAX_ADMIN: Joi.number().default(30),
  ADMIN_WHATSAPP_NUMBER: Joi.string().allow("").optional(),
  TELEGRAM_BOT_TOKEN: Joi.string().allow("").optional(),
  TELEGRAM_WEBHOOK_SECRET: Joi.string().allow("").optional(),
  HUMAN_HANDOFF_TIMEOUT_MINUTES: Joi.number().default(30),
  ONBOARDING_GUIDE_LINK: Joi.string().allow("").optional(),
  PURCHASE_LINK: Joi.string().allow("").optional(),
  CONTRACT_LINK: Joi.string().allow("").optional(),
  SALES_PRODUCT_NAME: Joi.string().allow("").optional(),
  SALES_PRODUCT_DESCRIPTION: Joi.string().allow("").optional(),
  SALES_PRODUCT_PRICE: Joi.string().allow("").optional(),
  SALES_PURCHASE_MESSAGE_BENEFITS: Joi.string().allow("").optional(),
  ADMIN_PRIVATE_RESET_CODE: Joi.string().allow("").optional(),
  SALES_DEMO_RESTAURANT_DATA: Joi.string().allow("").optional(),
  DIALOG_INTEGRATION_ENABLED: Joi.boolean().default(false),
  DIALOG_EMBEDDED_SIGNUP_URL: Joi.string().allow("").optional(),
  DIALOG_CALLBACK_TOKEN: Joi.string().allow("").optional(),
  INTERNAL_API_KEY: Joi.string().allow("").optional(),
  EXPIRED_KB_CLEANUP_INTERVAL_MINUTES: Joi.number().default(60),
}).unknown();

const { error, value } = schema.validate(process.env, { abortEarly: false });

if (error) {
  throw new Error(`Invalid environment configuration: ${error.message}`);
}

module.exports = value;
