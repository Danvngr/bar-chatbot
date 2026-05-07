const crypto = require("crypto");
const env = require("../config/env");

function verifySignatureWithSecret(req, res, next, secret) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !req.rawBody) {
    return res.status(403).send("Missing signature");
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("hex")}`;

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return res.status(403).send("Invalid signature");
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return res.status(403).send("Invalid signature");
  }

  return next();
}

function verifyWebhookSignature(req, res, next) {
  return verifySignatureWithSecret(req, res, next, env.WHATSAPP_APP_SECRET);
}

function verifyAdminWebhookSignature(req, res, next) {
  const secret = env.ADMIN_WHATSAPP_APP_SECRET || env.WHATSAPP_APP_SECRET;
  return verifySignatureWithSecret(req, res, next, secret);
}

module.exports = { verifyWebhookSignature, verifyAdminWebhookSignature };
