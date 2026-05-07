const { admin } = require("../config/firebase");

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" ");
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded.restaurant_id) {
      return res.status(403).json({ error: "Missing restaurant_id claim" });
    }

    req.user = {
      uid: decoded.uid,
      restaurantId: decoded.restaurant_id,
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = { requireAuth };
