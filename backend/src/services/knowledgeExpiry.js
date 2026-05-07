const { db, admin } = require("../config/firebase");
const env = require("../config/env");
const logger = require("../utils/logger");

async function cleanupExpiredKnowledgeBaseItems() {
  const now = admin.firestore.Timestamp.now();
  const restaurantsSnap = await db.collection("restaurants").get();
  if (restaurantsSnap.empty) {
    return 0;
  }

  let deletedCount = 0;

  for (const restaurantDoc of restaurantsSnap.docs) {
    let hasMore = true;
    while (hasMore) {
      const expiredSnap = await restaurantDoc.ref
        .collection("Knowledge_Base")
        .where("expires_at", "<=", now)
        .limit(400)
        .get();

      if (expiredSnap.empty) {
        hasMore = false;
        continue;
      }

      const batch = db.batch();
      expiredSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deletedCount += expiredSnap.size;

      hasMore = expiredSnap.size === 400;
    }
  }

  return deletedCount;
}

function startKnowledgeExpiryCleanupJob() {
  const intervalMs = Math.max(1, Number(env.EXPIRED_KB_CLEANUP_INTERVAL_MINUTES || 60)) * 60 * 1000;

  const run = async () => {
    try {
      const deleted = await cleanupExpiredKnowledgeBaseItems();
      if (deleted > 0) {
        logger.info("Expired Knowledge_Base items cleaned", { deleted });
      }
    } catch (error) {
      logger.error("Expired Knowledge_Base cleanup failed", { error: error.message });
    }
  };

  run();
  setInterval(run, intervalMs);
}

module.exports = { cleanupExpiredKnowledgeBaseItems, startKnowledgeExpiryCleanupJob };
