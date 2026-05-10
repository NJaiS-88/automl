require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { connectDb } = require("./config/db");
const { getGeneratedDir } = require("./config/paths");
const { STREAMLIT_PUBLIC_MOUNT } = require("./config/streamlitPublic");
const runsRouter = require("./routes/runs");
const authRouter = require("./routes/auth");
const streamlitRouter = require("./routes/streamlit");

const app = express();
let server;
app.set("trust proxy", 1);
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
  const isVercelDomain =
    /^https:\/\//i.test(normalizedRequestOrigin) &&
    (() => {
      try {
        return new URL(normalizedRequestOrigin).hostname.endsWith(".vercel.app");
      } catch {
        return false;
      }
    })();
  let isRenderOrigin = false;
  try {
    isRenderOrigin = new URL(normalizedRequestOrigin).hostname.endsWith(".onrender.com");
  } catch {
    isRenderOrigin = false;
  }
  return isAllowedExact || isVercelDomain || isRenderOrigin;
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
app.use(express.json({ limit: "5mb" }));
app.use("/generated", express.static(getGeneratedDir()));

function healthPayload() {
  const dbConnected = mongoose.connection.readyState === 1;
  return {
    ok: dbConnected,
    db: dbConnected ? "connected" : "disconnected",
  };
}

app.get("/api/health", (_req, res) => {
  const payload = healthPayload();
  if (!payload.ok) return res.status(503).json(payload);
  res.json(payload);
});

/** Alias for load balancers / Render health checks (same behavior as /api/health). */
app.get("/health", (_req, res) => {
  const payload = healthPayload();
  if (!payload.ok) return res.status(503).json(payload);
  res.json(payload);
});

app.use("/api/auth", authRouter);
app.use("/api/runs", runsRouter);
app.use("/api/streamlit", streamlitRouter);

const streamlitMountPrefix = `/${STREAMLIT_PUBLIC_MOUNT}`;
const streamlitProxy = createProxyMiddleware({
  target: "http://127.0.0.1:8501",
  changeOrigin: true,
  ws: true,
  pathFilter: (pathname) =>
    pathname === streamlitMountPrefix ||
    pathname.startsWith(`${streamlitMountPrefix}/`),
});
app.use(streamlitProxy);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || "Internal server error" });
});

const port = process.env.PORT || 4000;

function shutdown(signal) {
  console.log(`${signal} received, closing server...`);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close((closeErr) => {
    if (closeErr) console.error(closeErr);
    mongoose.connection
      .close(false)
      .then(() => {
        console.log("MongoDB connection closed.");
        process.exit(0);
      })
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  });
  setTimeout(() => process.exit(1), 25_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

connectDb(process.env.MONGODB_URI)
  .then(() => {
    server = app.listen(port, "0.0.0.0", () => {
      console.log(`Backend listening on port ${port}`);
    });
    server.on("upgrade", streamlitProxy.upgrade);
  })
  .catch((err) => {
    console.error("DB connection failed:", err.message);
    process.exit(1);
  });
