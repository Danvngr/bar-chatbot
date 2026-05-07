const Joi = require("joi");

const onboardingSchema = Joi.object({
  restaurant_id: Joi.string().trim().required(),
  name: Joi.string().trim().required(),
  phone_number: Joi.string().trim().required(),
  admin_phone: Joi.string().trim().required(),
  whatsapp_phone_number_id: Joi.string().trim().allow("").optional(),
  system_prompt_base: Joi.string().trim().required(),
  knowledge_base: Joi.array()
    .items(
      Joi.object({
        category: Joi.string().valid("hours", "kosher", "address", "menu", "rules", "custom", "event", "promotion").required(),
        content: Joi.string().trim().required(),
      })
    )
    .min(1)
    .required(),
});

const resolveQuestionSchema = Joi.object({
  answer: Joi.string().trim().required(),
});

const knowledgeBaseItemSchema = Joi.object({
  category: Joi.string().valid("hours", "kosher", "address", "menu", "rules", "custom", "event", "promotion").required(),
  content: Joi.string().trim().required(),
});

module.exports = {
  onboardingSchema,
  resolveQuestionSchema,
  knowledgeBaseItemSchema,
};
