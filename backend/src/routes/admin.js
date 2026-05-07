const express = require("express");
const { db, admin } = require("../config/firebase");
const { createEmbedding } = require("../services/openai");
const { listPendingQuestions, resolveQuestion } = require("../services/learning");
const { resolveQuestionSchema, knowledgeBaseItemSchema } = require("../validators/schemas");
const { invalidateCache } = require("../services/rag");
const { buildKnowledgeEntry } = require("../services/knowledgeNormalizer");

const router = express.Router();

function sanitizeSystemPromptBase(value = "") {
  const text = String(value || "").trim();
  if (!text) return { ok: false, reason: "Missing system prompt" };
  if (text.length > 4000) return { ok: false, reason: "system_prompt_base too long (max 4000 chars)" };
  const blockedPatterns = [
    /ignore all previous instructions/i,
    /ignore prior instructions/i,
    /system prompt/i,
    /reveal prompt/i,
    /developer message/i,
    /bypass/i,
    /jailbreak/i,
    /admin token/i,
    /api key/i,
    /secret/i,
  ];
  const hasBlocked = blockedPatterns.some((pattern) => pattern.test(text));
  if (hasBlocked) {
    return { ok: false, reason: "system_prompt_base contains blocked instructions" };
  }
  return { ok: true, value: text };
}

router.get("/dashboard", async (req, res) => {
  const { restaurantId } = req.user;
  const pendingSnap = await db
    .collection("unanswered_questions")
    .where("restaurant_id", "==", restaurantId)
    .where("status", "==", "PENDING")
    .get();
  const restaurantSnap = await db.collection("restaurants").doc(restaurantId).get();
  return res.json({
    restaurant: restaurantSnap.exists ? restaurantSnap.data() : null,
    pending_questions: pendingSnap.size,
  });
});

router.get("/knowledge-base", async (req, res) => {
  const { restaurantId } = req.user;
  const snap = await db.collection(`restaurants/${restaurantId}/Knowledge_Base`).get();
  return res.json(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
});

router.post("/knowledge-base", async (req, res) => {
  const { restaurantId } = req.user;
  const { error, value } = knowledgeBaseItemSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  const knowledgeEntry = await buildKnowledgeEntry({
    category: value.category,
    content: value.content,
  });
  const embedding = await createEmbedding(knowledgeEntry.embeddingText);
  const ref = await db.collection(`restaurants/${restaurantId}/Knowledge_Base`).add({
    ...value,
    content: knowledgeEntry.content,
    embedding,
    ...(knowledgeEntry.metadata || {}),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  invalidateCache(restaurantId);
  return res.status(201).json({ id: ref.id });
});

router.get("/learning-inbox", async (req, res) => {
  const { restaurantId } = req.user;
  const items = await listPendingQuestions(restaurantId);
  return res.json(items);
});

router.post("/learning-inbox/:questionId/resolve", async (req, res) => {
  const { restaurantId } = req.user;
  const { questionId } = req.params;
  const { error, value } = resolveQuestionSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  await resolveQuestion({ questionId, restaurantId, answer: value.answer });
  return res.json({ message: "Resolved and injected into knowledge base" });
});

router.put("/settings", async (req, res) => {
  const { restaurantId } = req.user;
  const promptCheck = sanitizeSystemPromptBase(req.body.system_prompt_base);
  if (!promptCheck.ok) {
    return res.status(400).json({ error: promptCheck.reason });
  }
  const payload = {
    name: req.body.name,
    phone_number: req.body.phone_number,
    system_prompt_base: promptCheck.value,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };
  await db.collection("restaurants").doc(restaurantId).set(payload, { merge: true });
  return res.json({ message: "Updated" });
});

module.exports = router;
