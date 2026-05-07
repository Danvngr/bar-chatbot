const { db, admin } = require("../config/firebase");

const PENDING_CONNECTIONS_COLLECTION = "pending_number_connections";

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

async function savePendingConnection({ adminPhone, inviteCode, phoneNumberId, payload = {} }) {
  const normalizedAdminPhone = normalizePhone(adminPhone);
  const normalizedPhoneNumberId = String(phoneNumberId || "").trim();
  if (!normalizedAdminPhone || !normalizedPhoneNumberId) {
    throw new Error("Missing adminPhone or phoneNumberId");
  }

  const ref = db.collection(PENDING_CONNECTIONS_COLLECTION).doc(normalizedAdminPhone);
  await ref.set(
    {
      admin_phone: normalizedAdminPhone,
      invite_code: String(inviteCode || "").trim().toUpperCase() || null,
      phone_number_id: normalizedPhoneNumberId,
      payload,
      connected_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return normalizedPhoneNumberId;
}

async function getPendingConnectionByAdminPhone(adminPhone) {
  const normalizedAdminPhone = normalizePhone(adminPhone);
  if (!normalizedAdminPhone) return null;

  const ref = db.collection(PENDING_CONNECTIONS_COLLECTION).doc(normalizedAdminPhone);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function consumePendingConnectionByAdminPhone(adminPhone) {
  const normalizedAdminPhone = normalizePhone(adminPhone);
  if (!normalizedAdminPhone) return null;

  const ref = db.collection(PENDING_CONNECTIONS_COLLECTION).doc(normalizedAdminPhone);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = { id: snap.id, ...snap.data() };
  await ref.delete();
  return data;
}

async function updateRestaurantWhatsAppNumber({ restaurantId, phoneNumberId }) {
  const id = String(restaurantId || "").trim();
  const numberId = String(phoneNumberId || "").trim();
  if (!id || !numberId) {
    throw new Error("Missing restaurantId or phoneNumberId");
  }

  const duplicates = await db
    .collection("restaurants")
    .where("whatsapp_phone_number_id", "==", numberId)
    .limit(2)
    .get();
  const hasOtherRestaurant = duplicates.docs.some((doc) => doc.id !== id);
  if (hasOtherRestaurant) {
    throw new Error("phoneNumberId already linked to another restaurant");
  }

  await db.collection("restaurants").doc(id).set(
    {
      whatsapp_phone_number_id: numberId,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

module.exports = {
  savePendingConnection,
  getPendingConnectionByAdminPhone,
  consumePendingConnectionByAdminPhone,
  updateRestaurantWhatsAppNumber,
};
