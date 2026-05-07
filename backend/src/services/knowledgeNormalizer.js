const env = require("../config/env");
const { chatCompletion } = require("./openai");

function normalizeLooseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/["'`״׳]/g, "")
    .replace(/[^\p{L}\p{N}\s:.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function containsAnyToken(text, tokens = []) {
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  return tokens.some((token) => normalized.includes(normalizeLooseText(token)));
}

function inferScopeTags({ category = "", topicTitle = "", question = "", answer = "", note = "", content = "" }) {
  const corpus = [
    String(category || ""),
    String(topicTitle || ""),
    String(question || ""),
    String(answer || ""),
    String(note || ""),
    String(content || ""),
  ].join(" ");

  const scopes = new Set();
  if (containsAnyToken(corpus, ["אירוע", "אירועים", "הופעה", "זמר", "dj", "מוצש", "מוצאי שבת"])) scopes.add("events");
  if (containsAnyToken(corpus, ["שולחן", "הזמנה", "reservation", "ontopo", "קבוצה גדולה", "דמי ביטול"])) scopes.add("reservation");
  if (containsAnyToken(corpus, ["מחיר", "תשלום", "פיקדון", "דמי", "כרטיס", "חינם", "שח", "ש\"ח", "fee", "deposit"])) scopes.add("payment");
  if (containsAnyToken(corpus, ["שעות", "פתוח", "סגור", "חג"])) scopes.add("hours");
  if (containsAnyToken(corpus, ["כתובת", "מיקום", "ניווט", "וויז", "address", "location"])) scopes.add("address");
  if (containsAnyToken(corpus, ["תפריט", "מנה", "מנות", "menu"])) scopes.add("menu");
  if (containsAnyToken(corpus, ["כשר", "כשרות", "רבנות", "מהדרין", "kosher"])) scopes.add("kosher");
  return Array.from(scopes);
}

function clipText(value, max = 90) {
  const clean = cleanText(value);
  if (!clean) return "";
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function normalizeNoValueTokens(value) {
  const clean = cleanText(value);
  const normalized = normalizeLooseText(clean);
  if (["", "אין", "לא", "none", "n/a", "-", "בלי", "לא צוין", "לא רלוונטי"].includes(normalized)) {
    return "אין";
  }
  return clean;
}

function normalizeDaysText(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  const normalized = normalizeLooseText(raw);
  if (normalized.includes("ימי חול") || normalized.includes("יום חול")) {
    return "ראשון-חמישי";
  }
  return raw
    .replace(/\bא[׳'"]?\s*-\s*ה[׳'"]?\b/g, "ראשון-חמישי")
    .replace(/\bא[׳'"]?\s*-\s*ו[׳'"]?\b/g, "ראשון-שישי")
    .replace(/\bיום\s*א(?:׳|')?|\bא(?:׳|')\b/g, "ראשון")
    .replace(/\bיום\s*ב(?:׳|')?|\bב(?:׳|')\b/g, "שני")
    .replace(/\bיום\s*ג(?:׳|')?|\bג(?:׳|')\b/g, "שלישי")
    .replace(/\bיום\s*ד(?:׳|')?|\bד(?:׳|')\b/g, "רביעי")
    .replace(/\bיום\s*ה(?:׳|')?|\bה(?:׳|')\b/g, "חמישי")
    .replace(/\bיום\s*ו(?:׳|')?|\bו(?:׳|')\b/g, "שישי")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTimesText(value) {
  const raw = normalizeDaysText(value);
  if (!raw) return "";
  const withColon = raw.replace(/(\d{1,2})\.(\d{2})/g, "$1:$2");
  const withRange = withColon
    .replace(/(\d{1,2})\s*עד\s*(\d{1,2})(?!:)/g, (_, a, b) => `${a}:00-${b}:00`)
    .replace(/(\d{1,2}):(\d{2})\s*עד\s*(\d{1,2}):(\d{2})/g, "$1:$2-$3:$4");
  return withRange.replace(/(\b\d{1,2}):(\d{2})/g, (_, h, m) => `${String(Number(h)).padStart(2, "0")}:${m}`);
}

function normalizeGenericKnowledgeText(value) {
  return normalizeNoValueTokens(normalizeTimesText(value));
}

function parseQuestionAnswerFromContent(content) {
  const text = String(content || "");
  const qMatch = text.match(/שאלה:\s*(.+)/);
  const aMatch = text.match(/תשובה:\s*([\s\S]+)/);
  if (qMatch && aMatch) {
    return {
      question: cleanText(qMatch[1]),
      answer: cleanText(aMatch[1]),
    };
  }

  const compact = cleanText(text);
  if (!compact) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  if (lines.length >= 2) {
    const first = lines[0];
    const rest = cleanText(lines.slice(1).join(" "));
    if (first && rest && first.length <= 120) {
      return { question: first, answer: rest };
    }
  }

  const separatorMatch = compact.match(/^(.{2,140}?)\s*(?:-|–|—|:)\s*(.{2,1000})$/);
  if (separatorMatch) {
    return {
      question: cleanText(separatorMatch[1]),
      answer: cleanText(separatorMatch[2]),
    };
  }
  return null;
}

function canExtractCustomQuestionAnswer(content) {
  return Boolean(parseQuestionAnswerFromContent(content));
}

function extractTopicCandidate(content) {
  const text = String(content || "").trim();
  if (!text) return "";
  const firstLine = text.split(/\r?\n/).map((line) => cleanText(line)).find(Boolean) || "";
  if (firstLine && firstLine.length <= 70) {
    return firstLine.replace(/[:\-–—]\s*$/, "").trim();
  }
  const compact = cleanText(text);
  const separatorMatch = compact.match(/^(.{2,70}?)\s*(?:-|–|—|:)\s*(.{2,1000})$/);
  if (separatorMatch) {
    return cleanText(separatorMatch[1]);
  }
  return clipText(compact, 70);
}

function inferDisplayStyle(answer) {
  const raw = String(answer || "");
  if (!raw.trim()) return "paragraph";
  if (/^\s*[-*•]/m.test(raw)) return "bullets";
  if (raw.split(/\r?\n/).filter((line) => cleanText(line)).length >= 3) return "bullets";
  if ((raw.match(/[;|]/g) || []).length >= 2) return "bullets";
  return "paragraph";
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const candidates = [raw];
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      // Try next candidate.
    }
  }
  return null;
}

async function enrichCustomKnowledgeStructure({ content = "", question = "", answer = "", intentNote = "" }) {
  const rawContent = cleanText(content);
  const rawQuestion = cleanText(question);
  const rawAnswer = cleanText(answer);
  const rawNote = cleanText(intentNote);

  const fallback = {
    topicTitle: clipText(rawNote || rawQuestion || extractTopicCandidate(rawContent), 70) || "נושא כללי",
    question: rawQuestion,
    answer: rawAnswer || normalizeGenericKnowledgeText(rawContent),
    answerStyle: inferDisplayStyle(rawAnswer || rawContent),
  };

  if (rawQuestion && rawAnswer) {
    return fallback;
  }

  if (!rawContent) {
    return fallback;
  }

  const prompt = [
    {
      role: "system",
      content: [
        "אתה מסדר נושא חופשי לבסיס ידע של מסעדה/בר.",
        "החזר JSON בלבד בפורמט:",
        "{\"topic_title\":\"...\",\"question\":\"...\",\"answer\":\"...\",\"answer_style\":\"paragraph|bullets\"}",
        "העברית חייבת להיות קצרה וטבעית.",
        "אל תמציא עובדות שלא כתובות בטקסט.",
        "אם אין שאלה מפורשת, הצע שאלה טבעית שלקוח עשוי לשאול על אותו נושא.",
        "אם יש כמה פרטים נפרדים, אפשר לבחור answer_style של bullets, אחרת paragraph.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        content: rawContent,
        question: rawQuestion,
        answer: rawAnswer,
        intent_note: rawNote,
      }),
    },
  ];

  try {
    const raw = await chatCompletion(prompt, {
      apiKey: env.ADMIN_OPENAI_API_KEY || env.OPENAI_API_KEY,
      model: env.ADMIN_OPENAI_CHAT_MODEL || env.OPENAI_CHAT_MODEL,
      temperature: 0.1,
      fallbackText: "",
    });
    const parsed = extractJsonObject(raw) || {};
    return {
      topicTitle: clipText(parsed.topic_title || fallback.topicTitle, 70) || fallback.topicTitle,
      question: cleanText(parsed.question || fallback.question),
      answer: cleanText(parsed.answer || fallback.answer),
      answerStyle: parsed.answer_style === "bullets" ? "bullets" : fallback.answerStyle,
    };
  } catch (_error) {
    return fallback;
  }
}

async function buildSemanticVariants({ question, answer, intentNote }) {
  const q = cleanText(question);
  const a = cleanText(answer);
  if (!q || !a) return [];
  const prompt = [
    {
      role: "system",
      content: [
        "אתה מייצר וריאציות סמנטיות לבסיס ידע של מסעדה.",
        "החזר JSON בלבד בפורמט: {\"variants\": [\"...\", \"...\"]}.",
        "כל וריאציה היא ניסוח אפשרי שלקוח עשוי לשאול.",
        "צור 3 עד 5 וריאציות קצרות בעברית.",
        "אם יש הקשר מיוחד, שלב אותו בוריאציות.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        question: q,
        answer: a,
        intent_note: cleanText(intentNote || ""),
      }),
    },
  ];
  try {
    const raw = await chatCompletion(prompt, {
      apiKey: env.ADMIN_OPENAI_API_KEY || env.OPENAI_API_KEY,
      model: env.ADMIN_OPENAI_CHAT_MODEL,
      temperature: 0.2,
      fallbackText: "",
    });
    const parsed = JSON.parse(String(raw || "").trim());
    const variants = Array.isArray(parsed?.variants)
      ? parsed.variants.map((v) => cleanText(v)).filter(Boolean).slice(0, 5)
      : [];
    return variants;
  } catch (_err) {
    return [];
  }
}

async function buildKnowledgeEntry({ category, content = "", question = "", answer = "", intentNote = "" }) {
  const safeCategory = String(category || "custom").trim();

  if (safeCategory !== "custom") {
    const normalizedContent = normalizeGenericKnowledgeText(content);
    return {
      content: normalizedContent,
      embeddingText: normalizedContent,
    };
  }

  let q = cleanText(question);
  let a = cleanText(answer);
  if ((!q || !a) && content) {
    const parsed = parseQuestionAnswerFromContent(content);
    if (parsed) {
      q = q || parsed.question;
      a = a || parsed.answer;
    }
  }
  const note = cleanText(intentNote);
  const structured = await enrichCustomKnowledgeStructure({
    content,
    question: q,
    answer: a,
    intentNote: note,
  });
  q = normalizeGenericKnowledgeText(structured.question || q);
  a = normalizeGenericKnowledgeText(structured.answer || a || content);
  const topicTitle = normalizeGenericKnowledgeText(structured.topicTitle || note || q || extractTopicCandidate(content));
  const answerStyle = structured.answerStyle === "bullets" ? "bullets" : "paragraph";
  const lines = [
    `נושא: ${topicTitle || "נושא כללי"}`,
    q ? `שאלה לדוגמה: ${q}` : null,
    `תשובה מאומתת: ${a}`,
    note ? `הקשר: ${normalizeGenericKnowledgeText(note)}` : null,
    `סגנון תצוגה מועדף: ${answerStyle === "bullets" ? "בולטים קצרים כשמתאים" : "פסקה קצרה וישירה"}`,
  ].filter(Boolean);
  const displayContent = lines.join("\n");

  const variants = await buildSemanticVariants({
    question: q || topicTitle,
    answer: a,
    intentNote: note,
  });
  const scopeTags = inferScopeTags({
    category: safeCategory,
    topicTitle,
    question: q,
    answer: a,
    note,
    content,
  });
  const embeddingParts = [displayContent];
  if (variants.length > 0) {
    embeddingParts.push(`ניסוחים דומים:\n- ${variants.join("\n- ")}`);
  }

  return {
    content: displayContent,
    embeddingText: embeddingParts.join("\n\n"),
    metadata: {
      topic_title: topicTitle || null,
      sample_question: q || null,
      answer_text: a || null,
      answer_style: answerStyle,
      aliases: variants,
      context_note: note || null,
      scope_tags: scopeTags,
    },
  };
}

module.exports = { buildKnowledgeEntry, canExtractCustomQuestionAnswer };
