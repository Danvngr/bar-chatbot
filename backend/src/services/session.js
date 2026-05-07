const { db, admin } = require("../config/firebase");

const BOT_ACTIVE = "BOT_ACTIVE";
const HUMAN_ACTIVE = "HUMAN_ACTIVE";
const RECENT_INBOUND_IDS_LIMIT = 50;

function sessionDocId(phoneNumber, restaurantId) {
  return `${phoneNumber}_${restaurantId}`;
}

async function getOrCreateSession(phoneNumber, restaurantId) {
  const id = sessionDocId(phoneNumber, restaurantId);
  const ref = db.collection("sessions").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    const data = {
      phone_number: phoneNumber,
      restaurant_id: restaurantId,
      status: BOT_ACTIVE,
      messages: [],
      recent_inbound_message_ids: [],
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(data);
    return { id, ...data };
  }
  return { id, ...snap.data() };
}

async function claimInboundMessage(sessionId, messageId) {
  const normalizedId = String(messageId || "").trim();
  if (!normalizedId) {
    return true;
  }

  const ref = db.collection("sessions").doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Session does not exist");
  }

  const current = snap.data();
  const currentIds = Array.isArray(current.recent_inbound_message_ids)
    ? current.recent_inbound_message_ids.filter(Boolean)
    : [];

  if (currentIds.includes(normalizedId)) {
    return false;
  }

  const nextIds = [...currentIds, normalizedId].slice(-RECENT_INBOUND_IDS_LIMIT);
  await ref.update({
    recent_inbound_message_ids: nextIds,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  return true;
}

async function addMessage(sessionId, role, content) {
  const ref = db.collection("sessions").doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Session does not exist");
  }
  const current = snap.data();
  const nextMessages = [...(current.messages || []), { role, content, ts: Date.now() }].slice(-15);
  const update = {
    messages: nextMessages,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (role === "user" && current.status === HUMAN_ACTIVE) {
    update.human_last_customer_message_at = admin.firestore.FieldValue.serverTimestamp();
  }
  await ref.update(update);
}

async function switchToHuman(sessionId, metadata = {}) {
  await db.collection("sessions").doc(sessionId).update({
    status: HUMAN_ACTIVE,
    human_handoff_reason: metadata.reason || null,
    human_handoff_at: admin.firestore.FieldValue.serverTimestamp(),
    human_last_customer_message_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function switchToBot(sessionId, metadata = {}) {
  await db.collection("sessions").doc(sessionId).update({
    status: BOT_ACTIVE,
    human_handoff_reason: null,
    human_handoff_released_reason: metadata.reason || null,
    human_handoff_released_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

module.exports = {
  BOT_ACTIVE,
  HUMAN_ACTIVE,
  getOrCreateSession,
  claimInboundMessage,
  addMessage,
  switchToHuman,
  switchToBot,
};
