const { db, admin } = require("../config/firebase");

const LEADS_COLLECTION = "leads";

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

async function upsertLead({ phone, stage, source = "admin_bot", notes = {} }) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const ref = db.collection(LEADS_COLLECTION).doc(normalizedPhone);
  const snap = await ref.get();
  const current = snap.exists ? snap.data() : null;
  const currentMessages = Number(current?.messages_count || 0);

  await ref.set(
    {
      phone: normalizedPhone,
      source,
      stage: String(stage || current?.stage || "new").trim() || "new",
      messages_count: currentMessages + 1,
      notes: {
        ...(current?.notes || {}),
        ...(notes || {}),
      },
      first_seen_at: current?.first_seen_at || admin.firestore.FieldValue.serverTimestamp(),
      last_seen_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return normalizedPhone;
}

async function markLeadConverted({ phone }) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return;

  await db.collection(LEADS_COLLECTION).doc(normalizedPhone).set(
    {
      stage: "converted",
      converted_at: admin.firestore.FieldValue.serverTimestamp(),
      last_seen_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function attachInviteCodeToLead({ phone, inviteCode }) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return;

  await db.collection(LEADS_COLLECTION).doc(normalizedPhone).set(
    {
      invite_code: String(inviteCode || "").trim().toUpperCase(),
      invite_sent_at: admin.firestore.FieldValue.serverTimestamp(),
      last_seen_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

module.exports = {
  upsertLead,
  markLeadConverted,
  attachInviteCodeToLead,
};
