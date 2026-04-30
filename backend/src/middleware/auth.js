const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [, token] = authHeader.split(" ");
  if (!token) return res.status(401).json({ message: "Missing auth token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret-change-me");
    req.user = { id: payload.userId, email: payload.email };
    next();
  } catch (_err) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

module.exports = { requireAuth };
