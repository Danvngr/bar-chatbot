const { db, admin } = require("../config/firebase");
const logger = require("../utils/logger");

const env = require("../config/env");

const TIMEOUT_MS = Number(env.HUMAN_HANDOFF_TIMEOUT_MINUTES || 30) * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function releaseStaleHumanSessions() {
  const cutoff = new Date(Date.now() - TIMEOUT_MS);

  const snap = await db
    .collection("sessions")
    .where("status", "==", "HUMAN_ACTIVE")
    .get();

  if (snap.empty) {
    return 0;
  }

  const stale = snap.docs.filter((doc) => {
    const data = doc.data();
    const timerField = data.human_last_customer_message_at || data.human_handoff_at || data.updated_at;
    if (!timerField || !timerField.toDate) return false;
    return timerField.toDate() <= cutoff;
  });

  if (stale.length === 0) {
    return 0;
  }

  const batch = db.batch();
  stale.forEach((doc) => {
    batch.update(doc.ref, {
      status: "BOT_ACTIVE",
      human_handoff_released_reason: "timeout",
      human_handoff_released_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  return stale.length;
}

function startSessionTimeoutJob() {
  const run = async () => {
    try {
      const released = await releaseStaleHumanSessions();
      if (released > 0) {
        logger.info("Released stale HUMAN_ACTIVE sessions", { count: released });
      }
    } catch (error) {
      logger.error("Session timeout job failed", { error: error.message });
    }
  };

  run();
  setInterval(run, CHECK_INTERVAL_MS);
}

module.exports = { startSessionTimeoutJob, releaseStaleHumanSessions };
