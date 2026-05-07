/**
 * One-off script: unlink a phone from being the admin of a restaurant.
 * Use case: stop being "business owner" of e.g. "בר לדוגמה" so you can try the flow again as a new lead.
 *
 * Run from backend: node scripts/unlink-admin-from-restaurant.js "בר לדוגמה"
 * Or with restaurant_id: node scripts/unlink-admin-from-restaurant.js --id <restaurant_id>
 */

const { db } = require("../src/config/firebase");

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

async function main() {
  const nameArg = process.argv[2];
  const idArg = process.argv[3];

  let restaurantRef = null;
  let restaurantId = null;
  let adminPhone = null;

  if (nameArg === "--id" && idArg) {
    restaurantId = idArg.trim();
    const ref = db.collection("restaurants").doc(restaurantId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.error("Restaurant not found with id:", restaurantId);
      process.exit(1);
    }
    restaurantRef = ref;
    const data = snap.data();
    adminPhone = data.admin_phone;
  } else if (nameArg) {
    const searchName = nameArg.trim();
    const snap = await db
      .collection("restaurants")
      .where("name", "==", searchName)
      .limit(1)
      .get();
    if (snap.empty) {
      console.error('No restaurant found with name exactly "' + searchName + '". Try --id <restaurant_id> or check the name in Firestore.');
      process.exit(1);
    }
    const doc = snap.docs[0];
    restaurantRef = doc.ref;
    restaurantId = doc.id;
    adminPhone = doc.data().admin_phone;
  } else {
    console.error('Usage: node scripts/unlink-admin-from-restaurant.js "Restaurant Name"');
    console.error('   or: node scripts/unlink-admin-from-restaurant.js --id <restaurant_id>');
    process.exit(1);
  }

  if (!adminPhone) {
    console.log("This restaurant has no admin_phone set. Nothing to unlink.");
    process.exit(0);
  }

  const normalizedPhone = normalizePhone(adminPhone);

  await restaurantRef.set({ admin_phone: "" }, { merge: true });
  console.log("Cleared admin_phone for restaurant:", restaurantId);

  const sessionRef = db.collection("admin_sessions").doc(normalizedPhone);
  const sessionSnap = await sessionRef.get();
  if (sessionSnap.exists) {
    await sessionRef.delete();
    console.log("Deleted admin_sessions for phone:", normalizedPhone);
  } else {
    console.log("No admin_sessions doc for this phone (already clean).");
  }

  console.log("Done. You can now message the admin bot as a new lead.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
