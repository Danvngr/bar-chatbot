const { db } = require("../config/firebase");
const { createEmbedding } = require("./openai");
const logger = require("../utils/logger");

const CACHE_TTL_MS = 5 * 60 * 1000;
const knowledgeCache = new Map();

function isNotExpired(item) {
  if (!item?.expires_at) {
    return true;
  }

  const nowMs = Date.now();

  if (typeof item.expires_at?.toDate === "function") {
    return item.expires_at.toDate().getTime() > nowMs;
  }

  const parsed = new Date(item.expires_at);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > nowMs;
}

async function loadAllKnowledge(restaurantId) {
  const snap = await db.collection(`restaurants/${restaurantId}/Knowledge_Base`).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter(isNotExpired);
}

function getCachedKnowledge(restaurantId) {
  const entry = knowledgeCache.get(restaurantId);
  if (entry && Date.now() - entry.loadedAt < CACHE_TTL_MS) {
    return entry.items.filter(isNotExpired);
  }
  return null;
}

async function getKnowledge(restaurantId) {
  const cached = getCachedKnowledge(restaurantId);
  if (cached) {
    return cached;
  }

  const items = await loadAllKnowledge(restaurantId);
  knowledgeCache.set(restaurantId, { items, loadedAt: Date.now() });
  logger.info("Knowledge cache refreshed", { restaurantId, itemCount: items.length });
  return items;
}

function invalidateCache(restaurantId) {
  if (restaurantId) {
    knowledgeCache.delete(restaurantId);
  } else {
    knowledgeCache.clear();
  }
}

function cosineSimilarity(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return -1;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i] || 0);
    const bv = Number(b[i] || 0);
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (!normA || !normB) {
    return -1;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function formatKnowledgeItemForContext(item = {}) {
  const category = String(item.category || "").trim() || "custom";
  const content = String(item.content || "").trim();
  if (category !== "custom") {
    return `[${category}] ${content}`;
  }

  const topicTitle = String(item.topic_title || "").trim();
  const answerText = String(item.answer_text || "").trim();
  const answerStyle = String(item.answer_style || "").trim();
  const sampleQuestion = String(item.sample_question || "").trim();
  const contextNote = String(item.context_note || "").trim();
  const aliases = Array.isArray(item.aliases)
    ? item.aliases.map((alias) => String(alias || "").trim()).filter(Boolean).slice(0, 5)
    : [];

  if (!topicTitle && !answerText) {
    return `[${category}] ${content}`;
  }

  const lines = [
    "[custom]",
    topicTitle ? `נושא: ${topicTitle}` : null,
    sampleQuestion ? `שאלה לדוגמה: ${sampleQuestion}` : null,
    answerText ? `תשובה מאומתת: ${answerText}` : content,
    contextNote ? `הקשר: ${contextNote}` : null,
    answerStyle === "bullets"
      ? "תצוגה מועדפת: אם המשתמש מבקש פירוט, אפשר לענות בבולטים קצרים."
      : "תצוגה מועדפת: פסקה קצרה, ישירה ולא חופרת.",
    aliases.length > 0 ? `ניסוחים דומים: ${aliases.join(" | ")}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}

async function retrieveKnowledgeContext(restaurantId, query = "", options = {}) {
  const items = await getKnowledge(restaurantId);
  const topK = Number(options.topK || 12);
  const minScore = typeof options.minScore === "number" ? options.minScore : 0.15;
  const cleanQuery = String(query || "").trim();

  if (!cleanQuery) {
    const fallbackItems = items.slice(0, topK);
    return {
      context: fallbackItems.map((item) => formatKnowledgeItemForContext(item)).join("\n"),
      items: fallbackItems,
    };
  }

  try {
    const queryEmbedding = await createEmbedding(cleanQuery);
    const scored = items
      .map((item) => ({
        ...item,
        score: cosineSimilarity(queryEmbedding, item.embedding),
      }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score);

    const selected = scored.filter((item) => item.score >= minScore).slice(0, topK);
    const finalItems = selected.length > 0 ? selected : scored.slice(0, Math.max(4, Math.min(topK, scored.length)));
    const context = finalItems.map((item) => formatKnowledgeItemForContext(item)).join("\n");
    return { context, items: finalItems };
  } catch (error) {
    logger.warn("RAG embedding retrieval failed, fallback to cached context", {
      restaurantId,
      error: error.message,
    });
    const fallbackItems = items.slice(0, topK);
    return {
      context: fallbackItems.map((item) => formatKnowledgeItemForContext(item)).join("\n"),
      items: fallbackItems,
    };
  }
}

module.exports = { retrieveKnowledgeContext, invalidateCache };
