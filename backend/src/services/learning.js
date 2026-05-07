const { db, admin } = require("../config/firebase");
const { createEmbedding } = require("./openai");
const { invalidateCache } = require("./rag");
const { buildKnowledgeEntry } = require("./knowledgeNormalizer");

async function logUnansweredQuestion({ restaurantId, phoneNumber, userMessage }) {
  const ref = await db.collection("unanswered_questions").add({
    restaurant_id: restaurantId,
    phone_number: phoneNumber,
    user_message: userMessage,
    status: "PENDING",
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function listPendingQuestions(restaurantId) {
  const snap = await db
    .collection("unanswered_questions")
    .where("restaurant_id", "==", restaurantId)
    .where("status", "==", "PENDING")
    .orderBy("created_at", "desc")
    .get();

  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function resolveQuestion({ questionId, restaurantId, answer }) {
  const ref = db.collection("unanswered_questions").doc(questionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Question not found");
  }
  const question = snap.data();
  if (question.restaurant_id !== restaurantId) {
    throw new Error("Forbidden");
  }

  const knowledgeEntry = await buildKnowledgeEntry({
    category: "custom",
    question: question.user_message || "",
    answer,
  });
  const embedding = await createEmbedding(knowledgeEntry.embeddingText);
  await db.collection(`restaurants/${restaurantId}/Knowledge_Base`).add({
    category: "custom",
    content: knowledgeEntry.content,
    embedding,
    ...(knowledgeEntry.metadata || {}),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  invalidateCache(restaurantId);

  await ref.update({
    status: "RESOLVED",
    admin_answer: answer,
    resolved_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  const sessionId = `${question.phone_number}_${restaurantId}`;
  await db.collection("sessions").doc(sessionId).set(
    {
      status: "BOT_ACTIVE",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

module.exports = { logUnansweredQuestion, listPendingQuestions, resolveQuestion };
