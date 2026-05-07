const crypto = require("crypto");

function validateManagerCode(code) {
  const value = String(code || "");
  const hasMinLength = value.length >= 8;
  const hasUpper = /[A-Z]/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSpecial = /[^A-Za-z0-9]/.test(value);

  if (hasMinLength && hasUpper && hasLower && hasDigit && hasSpecial) {
    return { valid: true, message: "" };
  }

  return {
    valid: false,
    message:
      "קוד מנהל חייב לכלול לפחות 8 תווים, אות גדולה, אות קטנה, מספר וסימן מיוחד. נסה שוב.",
  };
}

function hashManagerCode(managerCode, salt = null) {
  const finalSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(managerCode), finalSalt, 120000, 64, "sha512").toString("hex");
  return { hash, salt: finalSalt };
}

function verifyManagerCode(managerCode, storedHash, storedSalt) {
  if (!storedHash || !storedSalt) {
    return false;
  }
  const { hash } = hashManagerCode(managerCode, storedSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(String(storedHash), "hex"));
}

module.exports = {
  validateManagerCode,
  hashManagerCode,
  verifyManagerCode,
};
