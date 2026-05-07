const { db, admin } = require("../config/firebase");

const ADMIN_IDLE = "IDLE";
const ADMIN_COLLECTING = "COLLECTING";
const ADMIN_CONFIRMING = "CONFIRMING";
const ADMIN_REPLYING = "REPLYING";
const ADMIN_SAVE_CONFIRM = "SAVE_CONFIRM";
const ADMIN_KNOWLEDGE_INTENT_CLARIFY = "KNOWLEDGE_INTENT_CLARIFY";
const ADMIN_ONBOARDING = "ONBOARDING";
const ADMIN_ONBOARDING_CONFIRM = "ONBOARDING_CONFIRM";
const ADMIN_ONBOARDING_SKIP_SELECT = "ONBOARDING_SKIP_SELECT";
const ADMIN_ONBOARDING_EDIT_SELECT = "ONBOARDING_EDIT_SELECT";
const ADMIN_ONBOARDING_EDIT_ANSWER = "ONBOARDING_EDIT_ANSWER";
const ADMIN_FORGOT_CODE_VERIFY = "FORGOT_CODE_VERIFY";
const ADMIN_LOGIN_ASK_RESTAURANT_ID = "LOGIN_ASK_RESTAURANT_ID";
const ADMIN_LOGIN_ASK_MANAGER_CODE = "LOGIN_ASK_MANAGER_CODE";
const ADMIN_EVENT_OPTIONAL = "EVENT_OPTIONAL";
const ADMIN_EVENT_EDIT_SELECT = "EVENT_EDIT_SELECT";
const ADMIN_EVENT_EDIT_ANSWER = "EVENT_EDIT_ANSWER";
const ADMIN_AWAITING_NUMBER_CONNECT = "AWAITING_NUMBER_CONNECT";
const ADMIN_LEAD_SALES = "LEAD_SALES";
const ADMIN_LEAD_DEMO = "LEAD_DEMO";

function adminSessionId(phoneNumber) {
  return String(phoneNumber);
}

async function getOrCreateAdminSession(phoneNumber, restaurantId) {
  const id = adminSessionId(phoneNumber);
  const ref = db.collection("admin_sessions").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    const data = {
      phone_number: phoneNumber,
      restaurant_id: restaurantId,
      state: ADMIN_IDLE,
      pending_action: null,
      collected_data: {},
      messages: [],
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(data);
    return { id, ...data };
  }
  return { id, ...snap.data() };
}

async function pushAdminMessage(sessionId, role, content) {
  const ref = db.collection("admin_sessions").doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Admin session does not exist");
  }
  const current = snap.data();
  const nextMessages = [...(current.messages || []), { role, content, ts: Date.now() }].slice(-5);
  await ref.update({
    messages: nextMessages,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function updateAdminSessionState(sessionId, updates) {
  await db.collection("admin_sessions").doc(sessionId).set(
    {
      ...updates,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function resetAdminSession(sessionId) {
  await updateAdminSessionState(sessionId, {
    state: ADMIN_IDLE,
    pending_action: null,
    collected_data: {},
  });
}

module.exports = {
  ADMIN_IDLE,
  ADMIN_COLLECTING,
  ADMIN_CONFIRMING,
  ADMIN_REPLYING,
  ADMIN_SAVE_CONFIRM,
  ADMIN_KNOWLEDGE_INTENT_CLARIFY,
  ADMIN_ONBOARDING,
  ADMIN_ONBOARDING_CONFIRM,
  ADMIN_ONBOARDING_SKIP_SELECT,
  ADMIN_ONBOARDING_EDIT_SELECT,
  ADMIN_ONBOARDING_EDIT_ANSWER,
  ADMIN_FORGOT_CODE_VERIFY,
  ADMIN_LOGIN_ASK_RESTAURANT_ID,
  ADMIN_LOGIN_ASK_MANAGER_CODE,
  ADMIN_EVENT_OPTIONAL,
  ADMIN_EVENT_EDIT_SELECT,
  ADMIN_EVENT_EDIT_ANSWER,
  ADMIN_AWAITING_NUMBER_CONNECT,
  ADMIN_LEAD_SALES,
  ADMIN_LEAD_DEMO,
  getOrCreateAdminSession,
  pushAdminMessage,
  updateAdminSessionState,
  resetAdminSession,
};
