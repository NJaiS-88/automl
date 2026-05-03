require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { connectDb } = require("./config/db");
const runsRouter = require("./routes/runs");
const authRouter = require("./routes/auth");
const streamlitRouter = require("./routes/streamlit");

const app = express();
function normalizeOrigin(origin) {
  return String(origin || "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
}

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => normalizeOrigin(origin))
  .filter(Boolean);

function isAllowedOrigin(origin) {
  const normalizedRequestOrigin = normalizeOrigin(origin);
  if (!normalizedRequestOrigin) return true;

  const isAllowedExact = allowedOrigins.includes(normalizedRequestOrigin);
  const isVercelDomain = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(
    normalizedRequestOrigin
  );
  const isRenderPreview = /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(
    normalizedRequestOrigin
  );
  return isAllowedExact || isVercelDomain || isRenderPreview;
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "2mb" }));
app.use("/generated", express.static(path.join(process.cwd(), "generated")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/runs", runsRouter);
app.use("/api/streamlit", streamlitRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || "Internal server error" });
});

const port = process.env.PORT || 4000;
connectDb(process.env.MONGODB_URI)
  .then(() => {
    app.listen(port, () => {
      console.log(`Backend listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("DB connection failed:", err.message);
    process.exit(1);
  });
