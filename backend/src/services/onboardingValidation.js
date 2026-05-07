function normalizeText(value) {
  return String(value || "").trim();
}

function isNoValue(value) {
  const v = normalizeText(value).toLowerCase();
  return ["", "אין", "לא", "none", "-", "n/a", "בלי", "לא רלוונטי", "לא צוין"].includes(v);
}

function countDigits(value) {
  return (String(value || "").match(/\d/g) || []).length;
}

function looksLikeUrl(value) {
  const v = normalizeText(value);
  return /^https?:\/\/\S+/i.test(v) || /^www\./i.test(v);
}

function validateAddress(value) {
  const v = normalizeText(value);
  if (!v) {
    return { valid: false, message: "חסרה כתובת. כתוב כתובת מלאה של העסק." };
  }
  if (looksLikeUrl(v) && !/\d/.test(v)) {
    return { valid: false, message: "קיבלתי קישור בלבד. צריך גם כתובת כתובה (רחוב + עיר)." };
  }
  if (v.length < 6) {
    return { valid: false, message: "הכתובת קצרה מדי. כתוב כתובת מלאה יותר." };
  }
  return { valid: true, message: "" };
}

function validatePhone(value) {
  const v = normalizeText(value);
  if (!v) {
    return { valid: false, message: "חסר מספר טלפון לפניות. כתוב מספר תקין." };
  }
  const digits = String(v).replace(/\D/g, "");
  const local = digits.startsWith("972") && digits.length >= 11 ? `0${digits.slice(3)}` : digits;
  const normalizedLocal = local.startsWith("5") && local.length === 9 ? `0${local}` : local;
  const looksLikeIsraeli = /^0\d{8,9}$/.test(normalizedLocal);
  if (!looksLikeIsraeli) {
    return { valid: false, message: "מספר הטלפון לא נראה תקין. כתוב מספר ישראלי מלא (למשל 0501234567)." };
  }
  return { valid: true, message: "" };
}

function validateHours(value) {
  const v = normalizeText(value);
  if (!v) {
    return { valid: false, message: "חסרות שעות פתיחה. כתוב שעות בפורמט ברור." };
  }
  const hasDigit = /\d/.test(v);
  const hasTimeSeparator = /:|\.|עד|-|–/.test(v);
  if (!hasDigit || !hasTimeSeparator) {
    return { valid: false, message: "כדי להבין שעות פתיחה צריך לכלול שעות בפורמט כמו 12:00-22:00." };
  }
  return { valid: true, message: "" };
}

function validateKosher(value) {
  const v = normalizeText(value);
  if (!v) {
    return { valid: false, message: "צריך תשובה לגבי כשרות (למשל: אין כשרות / כשר למהדרין)." };
  }
  return { valid: true, message: "" };
}

function validateMenuLink(value) {
  const v = normalizeText(value);
  if (isNoValue(v)) {
    return { valid: true, message: "" };
  }
  if (!looksLikeUrl(v)) {
    return { valid: false, message: "אם יש תפריט אונליין, שלח קישור מלא (https://...). אחרת כתוב: אין" };
  }
  return { valid: true, message: "" };
}

function validateReservation(value) {
  const v = normalizeText(value);
  if (isNoValue(v)) {
    return { valid: true, message: "" };
  }
  const hasUrl = looksLikeUrl(v);
  const hasPhone = countDigits(v) >= 9;
  if (!hasUrl && !hasPhone) {
    return { valid: false, message: "לפרטי הזמנה שלח קישור או מספר טלפון. אם אין, כתוב: אין" };
  }
  return { valid: true, message: "" };
}

function validatePayment(value) {
  const v = normalizeText(value);
  if (!v) {
    return { valid: false, message: "חסרים אמצעי תשלום. כתוב למשל: מזומן, אשראי, ביט." };
  }
  if (v.length < 3) {
    return { valid: false, message: "אמצעי התשלום קצרים מדי. כתוב פירוט ברור." };
  }
  return { valid: true, message: "" };
}

function validateYesNoChoice(value) {
  const v = normalizeText(value).toLowerCase();
  if (["כן", "לא", "yes", "no", "יש", "אין"].includes(v)) {
    return { valid: true, message: "" };
  }
  return { valid: false, message: "ענה בבקשה 'כן' או 'לא'." };
}

function validateMenuDetails(value) {
  const v = normalizeText(value);
  if (isNoValue(v)) return { valid: true, message: "" };
  if (looksLikeUrl(v)) return { valid: true, message: "" };
  if (v.length < 6) {
    return { valid: false, message: "כתוב קישור או פירוט קצר וברור לתפריט." };
  }
  return { valid: true, message: "" };
}

function validateDeliveriesDetails(value) {
  const v = normalizeText(value);
  if (isNoValue(v)) return { valid: true, message: "" };
  if (v.length < 3) {
    return { valid: false, message: "כתוב בקצרה באילו פלטפורמות/אזורים יש משלוחים, או כתוב 'אין'." };
  }
  return { valid: true, message: "" };
}

function validateDeliveriesTracking(value) {
  const v = normalizeText(value);
  if (isNoValue(v)) return { valid: true, message: "" };
  if (looksLikeUrl(v)) return { valid: true, message: "" };
  if (v.length < 3) {
    return { valid: false, message: "כתוב איך מתבצע המעקב (לינק/אפליקציה/עדכון הודעות), או כתוב 'אין'." };
  }
  return { valid: true, message: "" };
}

function validateExtra(_value) {
  return { valid: true, message: "" };
}

function validateVenueStyle(value) {
  const v = normalizeText(value);
  if (!v || v.length < 2) {
    return { valid: false, message: "כתוב סגנון מקום ברור (למשל: בר, מסעדה, בית קפה)." };
  }
  return { valid: true, message: "" };
}

function validateDynamicText(value) {
  const v = normalizeText(value);
  if (isNoValue(v)) {
    return { valid: true, message: "" };
  }
  if (v.length < 2) {
    return { valid: false, message: "התשובה קצרה מדי. נסח עוד קצת או כתוב 'אין'." };
  }
  return { valid: true, message: "" };
}

function validateName(value) {
  const v = normalizeText(value);
  if (!v || v.length < 2) {
    return { valid: false, message: "שם העסק קצר מדי. כתוב שם מלא." };
  }
  return { valid: true, message: "" };
}

function validateOnboardingField(fieldKey, value) {
  const map = {
    venue_style: validateVenueStyle,
    name: validateName,
    address: validateAddress,
    phone_number: validatePhone,
    hours: validateHours,
    parking_enabled: validateYesNoChoice,
    accessibility_enabled: validateYesNoChoice,
    wifi_enabled: validateYesNoChoice,
    kosher_enabled: validateYesNoChoice,
    kosher: validateKosher,
    menu_link: validateMenuLink,
    menu_main: validateMenuDetails,
    has_dessert_menu: validateYesNoChoice,
    menu_dessert: validateMenuDetails,
    kids_menu_enabled: validateYesNoChoice,
    alcohol_menu_enabled: validateYesNoChoice,
    customer_club_enabled: validateYesNoChoice,
    gift_cards_enabled: validateYesNoChoice,
    inhouse_events_enabled: validateYesNoChoice,
    inhouse_events_entry_fee: validateDynamicText,
    inhouse_events_guidelines: validateDynamicText,
    private_events_enabled: validateYesNoChoice,
    sports_broadcasts_enabled: validateYesNoChoice,
    music_enabled: validateYesNoChoice,
    merchandise_enabled: validateYesNoChoice,
    lost_found_enabled: validateYesNoChoice,
    security_enabled: validateYesNoChoice,
    hiring_enabled: validateYesNoChoice,
    deliveries_enabled: validateYesNoChoice,
    deliveries_details: validateDeliveriesDetails,
    deliveries_tracking: validateDeliveriesTracking,
    reservation_enabled: validateYesNoChoice,
    reservation: validateReservation,
    payment: validatePayment,
    extra: validateExtra,
    music_program: validateDynamicText,
    signature_drinks: validateDynamicText,
    signature_dishes: validateDynamicText,
    dietary_options: validateDynamicText,
    coffee_specialty: validateDynamicText,
    work_friendly: validateDynamicText,
    manager_code: () => ({ valid: true, message: "" }),
  };

  const fn = map[fieldKey];
  if (fn) return fn(value);
  return validateDynamicText(value);
}

module.exports = {
  validateOnboardingField,
  isNoValue,
};
