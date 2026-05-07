const { db, admin } = require("../config/firebase");
const { createEmbedding } = require("./openai");

async function provisionRestaurant(payload) {
  const { restaurant_id: restaurantId, knowledge_base: knowledgeBase, ...restaurantInfo } = payload;
  const restaurantRef = db.collection("restaurants").doc(restaurantId);

  try {
    await restaurantRef.set({
      ...restaurantInfo,
      restaurant_id: restaurantId,
      status: "PROVISIONING",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const kbWrites = knowledgeBase.map(async (item) => {
      const embedding = await createEmbedding(item.content);
      return restaurantRef.collection("Knowledge_Base").add({
        category: item.category,
        content: item.content,
        embedding,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await Promise.all(kbWrites);
    await restaurantRef.update({
      status: "ACTIVE",
      activated_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    await restaurantRef.set({
      status: "SETUP_FAILED",
      setup_error: error.message,
      failed_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}

module.exports = { provisionRestaurant };
