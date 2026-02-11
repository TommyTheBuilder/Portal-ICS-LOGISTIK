const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_SUPER_SECRET";
if (JWT_SECRET === "CHANGE_ME_SUPER_SECRET" && process.env.ALLOW_INSECURE_JWT !== "true") {
  throw new Error("JWT_SECRET must be set (or explicitly set ALLOW_INSECURE_JWT=true for local dev only)");
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function adminRequired(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

module.exports = { authRequired, adminRequired, JWT_SECRET };
