const ALLOWED_ACTIONS = [
  "add_event",
  "update_hours",
  "update_kosher",
  "add_promotion",
  "add_custom",
  "update_custom",
  "delete_item",
  "view_knowledge",
  "get_knowledge_content",
  "continue_previous_list",
  "cancel",
  "unknown",
];

function buildAdminClassifierPrompt({ messageText, pendingAction = null, collectedData = {}, recentMessages = [] }) {
  const requiredByAction = {
    add_event: ["event_name", "date", "time"],
    update_hours: ["days", "hours_text"],
    update_kosher: ["kosher_type"],
    add_promotion: ["promotion_text"],
    add_custom: ["content"],
    update_custom: ["target_text", "content"],
    delete_item: ["target_text"],
    get_knowledge_content: ["query"],
  };

  return [
    {
      role: "system",
      content: `You are a parser for a restaurant owner management bot.
Return ONLY strict JSON (no markdown, no explanation).

Allowed actions: ${ALLOWED_ACTIONS.join(", ")}.
Required fields:
${JSON.stringify(requiredByAction)}

JSON schema:
{
  "action": "one of allowed actions",
  "fields": {
    "event_name": "string?",
    "date": "DD.MM.YYYY or ISO?",
    "time": "HH:mm?",
    "ticket_price": "string?",
    "reservation_required": "yes/no?",
    "details": "string?",
    "days": "string?",
    "hours_text": "string?",
    "kosher_type": "string?",
    "supervisor": "string?",
    "promotion_text": "string?",
    "end_date": "DD.MM.YYYY or ISO?",
    "content": "string?",
    "target_text": "string?",
    "query": "string?"
  }
}

If this is a follow-up answer, merge with existing context mentally and return only fields found in this new message.
Interpret Hebrew naturally and use the recent conversation context, not only keywords.
You are not a keyword matcher. Infer what the business owner is trying to do from the current message plus recent bot/user messages.
Short messages like "זה?", "לא זה", "את הכל", "המשך", "עוד", "תשנה את זה", "תמחק את זה" are often contextual follow-ups to the previous assistant answer.
If a short follow-up refers to a previous knowledge/list answer, infer the likely management action instead of returning unknown.
For action view_knowledge:
- Use when the owner asks to see everything saved, all questions/answers, all info, all topics, or a broad list of what the bot knows.
- Examples: "תשלח לי את השאלות", "שלח את כל השאלות", "תראה לי את כל המידע", "מה שמור אצלך", "כל הפרטים", "את הכל" when context is a list/knowledge view.
- Do NOT treat the word "שאלות" as a narrow topic when the sentence asks to send/show the questions broadly.
For action continue_previous_list:
- Use when the owner asks to continue a previously started list or paginated answer.
- This includes natural phrasing like "תשלחי עוד", "תשלח עוד", "תראה עוד", "תמשיכי", "תביא את השאר", "אפשר עוד?", "continue".
- Return continue_previous_list only when recent_messages or collected_data indicate there is an active list/page to continue.
- If there is no active list context, use unknown or the real requested action instead.
For action add_event:
- event_name must be the actual event title/name (for example: "הופעה של זמר מזרחי", "ערב קריוקי").
- Do NOT set event_name from generic descriptors like "חד פעמי", "חד\"פ", "אירוע חד פעמי", "אירוע חד\"פ".
- If user only indicates event type/frequency and no real title, keep event_name empty so the bot can ask for it.
- date can be numeric (DD.MM.YYYY / YYYY-MM-DD / ISO) or relative Hebrew date expressions (for example: "מחר", "מחרתיים", "שלישי הקרוב", "ביום ראשון", "שבוע הבא").
- If date is relative text, resolve it to a concrete date based on today and return date in DD.MM.YYYY.
- time must be returned in HH:mm 24h format. If user writes variants like "6 בערב", "18", "שש וחצי", convert to HH:mm.
- ticket_price should be normalized to a clear value: "חינם" or "<number> ש\"ח" when price exists.
- For optional fields, if user means no value ("אין", "לא רלוונטי", "בלי", "לא צוין"), return "אין".
For action update_hours:
- Normalize days to full Hebrew weekday names whenever possible (ראשון, שני, שלישי, רביעי, חמישי, שישי, שבת).
- If user writes abbreviations/ranges like "א-ה", "א'-ה'", "ימי חול", convert to clear day range text.
- Normalize hours_text to clear ranges with HH:mm when possible.
For action update_kosher:
- Normalize kosher_type to a clear consistent phrase (for example: "אין כשרות", "כשר", "כשר למהדרין").
For action delete_item:
- target_text should be focused search text that is likely to exist inside the saved knowledge item (event name / distinctive phrase / concrete date), not generic words like "אירוע" only.
For action update_custom:
- Use when the manager asks to change/update/replace existing saved information that is not opening hours or kosher.
- target_text should be the existing topic or phrase to find (for example: "תפריט", "חניה", "מבצע צהריים").
- content should be the new full customer-facing information to save.
- Do not use update_custom for a question/checking phrase like "האם יש...", "יש משהו על...", "מה רשום על...", "מה שמור על..." unless the manager clearly asks to update/change/add/save/write.
For action add_custom:
- Use when the manager adds a new fact/question/answer that is not clearly replacing an existing item.
- Do not use add_custom for a question/checking phrase like "האם יש...", "יש משהו על...", "מה רשום על...", "מה שמור על..." unless the manager clearly asks to update/change/add/save/write.
For action get_knowledge_content:
- Use when the manager asks to see content from the knowledge base: a specific topic (e.g. opening hours, kosher, a question they added) or "what I just added" / "how was it saved".
- This is an internal management intent, not a customer-facing reply. Prefer this action for phrases like "מה רשום על", "מה כתוב על", "מה שמור על", "האם יש משהו על", "יש משהו על", "רציתי לשאול על", "תראה לי את הנושא".
- query: the topic or exact phrase they asked (e.g. "שעות פתיחה", "כשרות", "מה השעות?", "מה הוספתי עכשיו", "איך זה נשמר").
- If the owner asks a broad list question, use view_knowledge, not get_knowledge_content.
- Never return placeholders like "unknown" for required fields when user gave a meaningful answer.
If uncertain, set action to "unknown".`,
    },
    {
      role: "user",
      content: JSON.stringify({
        pending_action: pendingAction,
        collected_data: collectedData,
        recent_messages: Array.isArray(recentMessages) ? recentMessages.slice(-8) : [],
        message: messageText,
      }),
    },
  ];
}

function buildAdminSummary(action, data) {
  if (action === "add_event") {
    return [
      "*סיכום עדכון אירוע:*",
      `• *שם אירוע:* ${data.event_name || "-"}`,
      `• *תאריך:* ${data.date || "-"}`,
      `• *שעה:* ${data.time || "-"}`,
      `• *מחיר:* ${data.ticket_price || "לא צוין"}`,
      `• *הזמנה מראש:* ${data.reservation_required || "לא צוין"}`,
      `• *פרטים נוספים:* ${data.details || "אין"}`,
    ].join("\n");
  }
  if (action === "update_hours") {
    return ["*סיכום עדכון שעות:*", `• *ימים:* ${data.days || "-"}`, `• *שעות:* ${data.hours_text || "-"}`].join("\n");
  }
  if (action === "update_kosher") {
    return [
      "*סיכום עדכון כשרות:*",
      `• *סוג כשרות:* ${data.kosher_type || "-"}`,
      `• *גוף משגיח:* ${data.supervisor || "לא צוין"}`,
    ].join("\n");
  }
  if (action === "add_promotion") {
    return [
      "*סיכום הוספת מבצע:*",
      `• *תיאור:* ${data.promotion_text || "-"}`,
      `• *תוקף עד:* ${data.end_date || "לא צוין"}`,
    ].join("\n");
  }
  if (action === "add_custom") {
    return ["*סיכום הוספת מידע כללי:*", `• *תוכן:* ${data.content || "-"}`].join("\n");
  }
  if (action === "update_custom") {
    return [
      "*סיכום עריכת מידע:*",
      `• *נושא/טקסט לחיפוש:* ${data.target_text || "-"}`,
      `• *נוסח חדש:* ${data.content || "-"}`,
    ].join("\n");
  }
  if (action === "delete_item") {
    return ["*סיכום מחיקה:*", `• *טקסט לחיפוש ומחיקה:* ${data.target_text || "-"}`].join("\n");
  }
  return "לא זוהתה פעולה ברורה.";
}

module.exports = { ALLOWED_ACTIONS, buildAdminClassifierPrompt, buildAdminSummary };
