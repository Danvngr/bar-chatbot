const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function srcPath(relativeFromSrc) {
  return require.resolve(path.resolve(__dirname, "../../src", relativeFromSrc));
}

function setMock(relativeFromSrc, exportsValue) {
  const abs = srcPath(relativeFromSrc);
  require.cache[abs] = {
    id: abs,
    filename: abs,
    loaded: true,
    exports: exportsValue,
  };
}

function resetModules() {
  [
    "services/sessionTimeout.js",
    "config/firebase.js",
    "config/env.js",
    "utils/logger.js",
  ].forEach((rel) => {
    const abs = srcPath(rel);
    delete require.cache[abs];
  });
}

test("releaseStaleHumanSessions returns handoff session to bot silently", async () => {
  resetModules();
  const updates = [];
  const staleDate = new Date(Date.now() - 15 * 60 * 1000);
  const freshDate = new Date(Date.now() - 60 * 1000);

  const docs = [
    {
      ref: { id: "stale" },
      data: () => ({
        human_last_customer_message_at: { toDate: () => staleDate },
      }),
    },
    {
      ref: { id: "fresh" },
      data: () => ({
        human_last_customer_message_at: { toDate: () => freshDate },
      }),
    },
  ];

  setMock("config/env.js", {
    HUMAN_HANDOFF_TIMEOUT_MINUTES: 10,
  });
  setMock("config/firebase.js", {
    db: {
      collection(name) {
        assert.equal(name, "sessions");
        return {
          where(field, op, value) {
            assert.equal(field, "status");
            assert.equal(op, "==");
            assert.equal(value, "HUMAN_ACTIVE");
            return {
              async get() {
                return { empty: false, docs };
              },
            };
          },
        };
      },
      batch() {
        return {
          update(ref, data) {
            updates.push({ ref, data });
          },
          async commit() {},
        };
      },
    },
    admin: {
      firestore: {
        FieldValue: {
          serverTimestamp: () => "__ts__",
        },
      },
    },
  });
  setMock("utils/logger.js", {
    info: () => {},
    error: () => {},
  });

  const { releaseStaleHumanSessions } = require(srcPath("services/sessionTimeout.js"));
  const released = await releaseStaleHumanSessions();

  assert.equal(released, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].ref.id, "stale");
  assert.equal(updates[0].data.status, "BOT_ACTIVE");
  assert.equal(updates[0].data.human_handoff_released_reason, "timeout");
});
