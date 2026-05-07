const crypto = require("crypto");
const { db, admin } = require("../config/firebase");

const INVITE_CODES_COLLECTION = "invite_codes";
const STATUS_PENDING = "PENDING";
const STATUS_USED = "USED";

function normalizeInviteCode(code) {
  return String(code || "").trim().toUpperCase();
}

function generateInviteCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  while (code.length < length) {
    const byte = crypto.randomBytes(1)[0];
    code += alphabet[byte % alphabet.length];
  }
  return code;
}

async function createInviteCode(code = null) {
  const finalCode = normalizeInviteCode(code || generateInviteCode());
  const ref = db.collection(INVITE_CODES_COLLECTION).doc(finalCode);
  await ref.set(
    {
      code: finalCode,
      status: STATUS_PENDING,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return finalCode;
}

async function getPendingInviteCode(code) {
  const finalCode = normalizeInviteCode(code);
  if (!finalCode) return null;
  const snap = await db.collection(INVITE_CODES_COLLECTION).doc(finalCode).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.status !== STATUS_PENDING) return null;
  return { id: snap.id, ...data };
}

async function redeemInviteCode({ code, usedBy }) {
  const finalCode = normalizeInviteCode(code);
  const ref = db.collection(INVITE_CODES_COLLECTION).doc(finalCode);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Invite code not found");
  }
  const data = snap.data();
  if (data.status !== STATUS_PENDING) {
    throw new Error("Invite code already used");
  }
  await ref.set(
    {
      status: STATUS_USED,
      used_by: String(usedBy || "").trim(),
      used_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

module.exports = {
  STATUS_PENDING,
  STATUS_USED,
  normalizeInviteCode,
  generateInviteCode,
  createInviteCode,
  getPendingInviteCode,
  redeemInviteCode,
};
