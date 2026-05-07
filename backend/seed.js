require("dotenv").config();
const { admin, db } = require("./src/config/firebase");
const { createEmbedding } = require("./src/services/openai");

const restaurantId = process.env.PILOT_RESTAURANT_ID || "patricks_modiin";

const knowledgeBaseItems = [
  {
    category: "hours",
    content:
      "שעות פתיחה: ראשון עד רביעי 18:00-01:00, חמישי 18:00-02:00, שישי סגור, מוצאי שבת 45 דקות לאחר צאת השבת.",
  },
  {
    category: "hours",
    content: "היום אנחנו פותחים ב-18:00 (אלא אם כן היום שישי, ואז אנחנו סגורים). במוצאי שבת מ-19:00.",
  },
  {
    category: "address",
    content:
      "אנחנו בדם המכבים 36 במע״ר מודיעין. ניווט בוויז: https://waze.com/ul?q=פטריקס+מודיעין. יש הרבה חניה במע״ר.",
  },
  {
    category: "menu",
    content: "הנה התפריט שלנו: https://menu.hopa.tech/JblF6SB3jA4Q4hJQHybB",
  },
  {
    category: "reservations",
    content: "להזמנת שולחן מראש: https://ontopo.com/he/il/page/99178566",
  },
  {
    category: "events_weekly",
    content:
      "אירועים שבועיים: ראשון המבורגרים 1+1, שני ערב 80-90, שלישי ערב ים תיכוני עם זמר אורח, רביעי ערב ישראלי עם DJ, חמישי מוזיקה חזקה והמון אלכוהול, שישי סגור, שבת סוגרים את השבוע במוצאי שבת.",
  },
  {
    category: "event",
    content: "ערב ים תיכוני עם הזמר שימי מזרחי בתאריך 03.03.2026. מחיר: 50 ש\"ח לאדם.",
    expires_at: "2026-03-04",
  },
  {
    category: "event",
    content: "ערב ים תיכוני עם הזמרת גלית סדן בתאריך 10.03.2026. מחיר: 50 ש\"ח לאדם.",
    expires_at: "2026-03-11",
  },
  {
    category: "event",
    content: "ערב ים תיכוני עם הזמר ליאור מיארה בתאריך 17.03.2026. מחיר: 50 ש\"ח לאדם.",
    expires_at: "2026-03-18",
  },
  {
    category: "event",
    content: "ערב ים תיכוני עם הזמר שימי מזרחי בתאריך 24.03.2026. מחיר: 50 ש\"ח לאדם.",
    expires_at: "2026-03-25",
  },
  {
    category: "event",
    content: "ערב ים תיכוני עם הזמר ליאור מיארה בתאריך 31.03.2026. מחיר: 50 ש\"ח לאדם.",
    expires_at: "2026-04-01",
  },
  {
    category: "custom",
    content: "שידורי ספורט: אין אצלנו שידורי ספורט בכלל.",
  },
  {
    category: "private_events",
    content: "אירועים פרטיים: השאירו טלפון ומנהל יחזור אליכם עם פרטים.",
  },
  {
    category: "specials",
    content: "חיילים, מילואימניקים וסטודנטים מקבלים פינוק עם הצגת תעודה.",
  },
  {
    category: "policy",
    content:
      "עישון מותר רק באזורים המוגדרים לכך בחוץ ובמתחם VIP. אפשר להגיע עם כלבים לאזור החוץ. כניסה מגיל 18+ בלבד.",
  },
  {
    category: "drinks",
    content:
      "יש תפריט קוקטיילים מגוון. במקום 24 ברזי בירה מהחבית. המוזיקה לרוב מיינסטרים, ובסופ״ש DJ עם טכנו והאוס.",
  },
  {
    category: "kosher",
    content: "המקום כשר עם כשרות רבנות מודיעין.",
  },
];

async function upsertRestaurant() {
  await db.collection("restaurants").doc(restaurantId).set(
    {
      restaurant_id: restaurantId,
      name: "פטריקס מודיעין",
      phone_number: process.env.PILOT_RESTAURANT_PHONE || "",
      admin_phone: process.env.PILOT_ADMIN_PHONE || "",
      whatsapp_phone_number_id: process.env.PILOT_WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
      system_prompt_base:
        "אתה נציג שירות של הבר פטריקס מודיעין. תענה בעברית, בקצרה ובנימוס. מותר לענות רק על מידע שקשור לבר. אם אין תשובה במידע הנתון, החזר TRANSFER_TO_HUMAN.",
      status: "ACTIVE",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function seedKnowledgeBase() {
  const kbRef = db.collection(`restaurants/${restaurantId}/Knowledge_Base`);

  const existing = await kbRef.get();
  const deleteOps = existing.docs.map((doc) => doc.ref.delete());
  await Promise.all(deleteOps);

  for (const item of knowledgeBaseItems) {
    const embedding = await createEmbedding(item.content);
    await kbRef.add({
      category: item.category,
      content: item.content,
      embedding,
      expires_at: item.expires_at || null,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

async function seedData() {
  try {
    console.log(`--- מתחיל seed למסעדה ${restaurantId} ---`);
    await upsertRestaurant();
    console.log("✅ מסמך מסעדה נשמר");
    await seedKnowledgeBase();
    console.log(`✅ הוזנו ${knowledgeBaseItems.length} פריטי Knowledge_Base עם embeddings`);
    console.log("--- הסתיים בהצלחה ---");
    process.exit(0);
  } catch (error) {
    console.error("❌ שגיאה ב-seed:", error);
    process.exit(1);
  }
}

seedData();