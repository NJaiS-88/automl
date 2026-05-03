const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const util = require("util");
const execFileAsync = util.promisify(require("child_process").execFile);
const mongoose = require("mongoose");

const { requireAuth } = require("../middleware/auth");
const RunHistory = require("../models/RunHistory");

const router = express.Router();

function getStreamlitAppPath() {
  return path.join(__dirname, "..", "..", "..", "streamlit_tailored_app", "app.py");
}

function getRequirementsPath() {
  return path.join(__dirname, "..", "..", "requirements.txt");
}

function getStreamlitRuntimeDir() {
  return path.join(__dirname, "..", "..", "..", "streamlit_tailored_app", "runtime");
}

function inferFeatureKinds(featureColumns, previewRows) {
  const row = Array.isArray(previewRows) && previewRows[0] ? previewRows[0] : {};
  const kinds = {};
  for (const col of featureColumns) {
    const v = row[col];
    if (v === null || v === undefined || v === "") {
      kinds[col] = "number";
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      kinds[col] = "number";
    } else if (typeof v === "boolean") {
      kinds[col] = "number";
    } else if (typeof v === "string" && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(v).trim())) {
      kinds[col] = "number";
    } else {
      kinds[col] = "text";
    }
  }
  return kinds;
}

function finalModelLabel(report) {
  if (!report || typeof report !== "object") return "Final model";
  const dev2 = report.dev2?.choice || {};
  const members = dev2.members || [];
  const dev3 = report.dev3 || {};
  if (dev3.selected_model_version === "improved" && dev3.best_candidate_name) {
    return String(dev3.best_candidate_name);
  }
  if (dev2.type === "ensemble" && members.length) {
    return `Ensemble (${members.join(", ")})`;
  }
  return members[0] ? String(members[0]) : "Final model";
}

function buildStreamlitRunMeta(run, projectRoot) {
  const cols = Array.isArray(run.featureColumns) ? run.featureColumns.map(String) : [];
  return {
    runId: String(run._id),
    runName: run.name || run.datasetFilename || "Run",
    projectName: run.projectName || "",
    datasetFilename: run.datasetFilename || "",
    targetCol: run.targetCol || "target",
    problemType: run.report?.problem_type || "classification",
    finalModelLabel: finalModelLabel(run.report),
    featureColumns: cols,
    featureKinds: inferFeatureKinds(cols, run.previewRows),
    metricsSummary: run.metricsSummary || null,
    projectRoot: String(projectRoot),
  };
}

async function prepareStreamlitRunContext(req) {
  const runId = req.body?.runId;
  if (!mongoose.Types.ObjectId.isValid(String(runId))) {
    const err = new Error("INVALID_RUN_ID");
    err.status = 400;
    throw err;
  }
  const run = await RunHistory.findOne({ _id: runId, userId: req.user.id });
  if (!run) {
    const err = new Error("RUN_NOT_FOUND");
    err.status = 404;
    throw err;
  }
  if (run.status !== "completed") {
    const err = new Error("RUN_NOT_COMPLETED");
    err.status = 400;
    throw err;
  }
  if (!run.modelPath) {
    const err = new Error("NO_MODEL_PATH");
    err.status = 400;
    throw err;
  }
  const projectRoot = process.env.PROJECT_ROOT || path.resolve(process.cwd(), "..");
  const absModel = path.isAbsolute(run.modelPath)
    ? run.modelPath
    : path.resolve(process.cwd(), run.modelPath);
  if (!fs.existsSync(absModel)) {
    const err = new Error("MODEL_FILE_MISSING");
    err.status = 400;
    throw err;
  }

  const runtimeDir = getStreamlitRuntimeDir();
  fs.mkdirSync(runtimeDir, { recursive: true });
  const metaPath = path.join(runtimeDir, "current_run_meta.json");
  const meta = buildStreamlitRunMeta(run, projectRoot);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

  // Streamlit process keeps OS env from startup — switching runs updates this file so the UI reloads the right model without restarting Streamlit.
  const activePath = path.join(runtimeDir, "active_context.json");
  fs.writeFileSync(
    activePath,
    JSON.stringify(
      {
        modelPath: absModel,
        metaPath,
        projectRoot: String(projectRoot),
        runId: String(run._id),
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );

  return {
    extras: {
      AUTOML_STREAMLIT_MODEL_PATH: absModel,
      AUTOML_STREAMLIT_META_PATH: metaPath,
      AUTOML_PROJECT_ROOT: String(projectRoot),
    },
    metaWritten: true,
  };
}

async function tryImportStreamlit(exe, prefixArgs = []) {
  const args = [...prefixArgs, "-c", "import streamlit; print(streamlit.__version__)"];
  const { stdout } = await execFileAsync(exe, args);
  return stdout.toString().trim();
}

/**
 * Find a Python that has Streamlit installed (matches notebook / backend ML stack).
 */
async function resolvePythonWithStreamlit() {
  const candidates = [];
  const py = process.env.PYTHON?.trim();
  if (py) candidates.push({ exe: py, prefix: [] });

  if (process.platform === "win32") {
    // Match ensurePythonDeps.js: prefer 3.10–3.12 so we don’t pick 3.13 (often missing wheels / no pip install).
    for (const v of ["-3.12", "-3.11", "-3.10", "-3.9", "-3"]) {
      candidates.push({ exe: "py", prefix: [v] });
    }
    candidates.push({ exe: "python", prefix: [] });
    candidates.push({ exe: "python3", prefix: [] });
  } else {
    candidates.push({ exe: "python3", prefix: [] });
    candidates.push({ exe: "python", prefix: [] });
  }

  const tried = new Set();
  const errors = [];
  for (const { exe, prefix } of candidates) {
    const key = `${exe}\0${prefix.join(",")}`;
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      const ver = await tryImportStreamlit(exe, prefix);
      return { exe, prefix, streamlitVersion: ver };
    } catch (e) {
      errors.push(`${exe} ${prefix.join(" ")}: ${e.message}`);
    }
  }

  const err = new Error("NO_PYTHON_STREAMLIT");
  err.attempts = errors;
  throw err;
}

/** Args for `python.exe -m streamlit run …` (no `py` launcher — avoids a blank Windows console). */
function buildStreamlitModuleArgs(appPath, port) {
  return [
    "-m",
    "streamlit",
    "run",
    appPath,
    "--server.port",
    String(port),
    "--server.address",
    "127.0.0.1",
    "--server.headless",
    "true",
    "--browser.gatherUsageStats",
    "false",
  ];
}

function streamlitSpawnOptions(cwd, env) {
  const isWin = process.platform === "win32";
  return {
    cwd,
    // detached:true on Windows makes Node ignore stdio and attach a console → blank py.exe window
    detached: !isWin,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
    env,
  };
}

/** Same flags as python -m streamlit, for direct `streamlit run …` (shell PATH). */
function buildStreamlitCliArgs(appPath, port) {
  return [
    "run",
    appPath,
    "--server.port",
    String(port),
    "--server.address",
    "127.0.0.1",
    "--server.headless",
    "true",
    "--browser.gatherUsageStats",
    "false",
  ];
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => {
      child.removeListener("error", reject);
      resolve();
    });
  });
}

async function getResolvedPythonExecutable(exe, prefix = []) {
  const args = [...prefix, "-c", "import sys; print(sys.executable)"];
  const { stdout } = await execFileAsync(exe, args);
  return stdout.toString().trim();
}

/** Prepend that Python’s Scripts folder on PATH (Windows). */
function envWithPythonScriptsFromExe(pythonExe) {
  const base = { ...process.env, PYTHONUNBUFFERED: "1" };
  if (process.platform !== "win32") return base;
  const scripts = path.join(path.dirname(pythonExe), "Scripts");
  if (fs.existsSync(scripts)) {
    const sep = path.delimiter;
    base.PATH = `${scripts}${sep}${process.env.PATH || ""}`;
  }
  return base;
}

/**
 * Like `exec("streamlit run app.py --server.port …")` but non-blocking: detached child.
 * Uses shell so Windows finds `streamlit`/`streamlit.cmd` from pip Scripts on PATH.
 */
/**
 * Try methods in order: real `python.exe -m streamlit`, Windows `Scripts\\streamlit.exe`, shell `streamlit`.
 * @param {string} pythonExe Absolute path to python.exe (never `py.exe`).
 */
async function startStreamlitWithFallbacks(pythonExe, appPath, port, cwd, env) {
  const opts = streamlitSpawnOptions(cwd, env);
  const runners = [
    async () => {
      const child = spawn(pythonExe, buildStreamlitModuleArgs(appPath, port), opts);
      await waitForSpawn(child);
      child.unref();
    },
  ];

  if (process.platform === "win32") {
    runners.push(async () => {
      const streamlitExe = path.join(path.dirname(pythonExe), "Scripts", "streamlit.exe");
      if (!fs.existsSync(streamlitExe)) {
        throw new Error("streamlit.exe not next to this Python");
      }
      const child = spawn(streamlitExe, buildStreamlitCliArgs(appPath, port), opts);
      await waitForSpawn(child);
      child.unref();
    });
  }

  runners.push(async () => {
    const child = spawn("streamlit", buildStreamlitCliArgs(appPath, port), {
      ...opts,
      shell: true,
      detached: false,
    });
    await waitForSpawn(child);
    child.unref();
  });

  let lastErr = null;
  for (const run of runners) {
    try {
      await run();
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Failed to start Streamlit");
}

function probeHttp(url, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function waitUntilStreamlitResponds(port, maxWaitMs = 35000) {
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + maxWaitMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const code = await probeHttp(url, 3000);
      if (code > 0 && code < 500) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  const hint = lastErr ? lastErr.message : "no response";
  const err = new Error("STREAMLIT_START_TIMEOUT");
  err.hint = hint;
  throw err;
}

router.get("/check", requireAuth, async (_req, res) => {
  try {
    const appPath = getStreamlitAppPath();
    const reqPath = getRequirementsPath();
    if (!fs.existsSync(appPath)) {
      return res.status(500).json({
        ok: false,
        appFound: false,
        message: `Missing Streamlit app at ${appPath}`,
      });
    }
    const resolved = await resolvePythonWithStreamlit();
    let pythonExecutable = resolved.exe;
    try {
      pythonExecutable = await getResolvedPythonExecutable(resolved.exe, resolved.prefix);
    } catch (_) {
      /* keep launcher path */
    }
    return res.json({
      ok: true,
      python: pythonExecutable,
      pythonPrefix: resolved.prefix,
      streamlitVersion: resolved.streamlitVersion,
      appPath,
      requirementsPath: fs.existsSync(reqPath) ? reqPath : null,
    });
  } catch (e) {
    const reqPath = getRequirementsPath();
    const pipHint =
      process.platform === "win32"
        ? `cd automl/backend && npm run install-python-deps   (or py -3.12 -m pip install -r "${reqPath}")`
        : `python3 -m pip install -r "${reqPath}"`;
    return res.status(200).json({
      ok: false,
      ready: false,
      message:
        e.code === "NO_PYTHON_STREAMLIT" || e.message === "NO_PYTHON_STREAMLIT"
          ? "No Python on PATH has Streamlit installed."
          : e.message,
      installCommand: pipHint,
      requirementsPath: fs.existsSync(reqPath) ? reqPath : null,
    });
  }
});

router.post("/start", requireAuth, async (req, res) => {
  const requirementsPath = getRequirementsPath();
  const pipHintWin = `npm run install-python-deps (in automl/backend) or py -3.12 -m pip install -r "${requirementsPath}"`;
  const pipHintUnix = `python3 -m pip install -r "${requirementsPath}"`;

  if (!req.body?.runId) {
    return res.status(400).json({
      message:
        "Missing runId. Open a completed run, go to Downloads, and click “Run Streamlit app” so your trained model and features load.",
      requirementsPath,
    });
  }

  try {
    const appPath = getStreamlitAppPath();
    if (!fs.existsSync(appPath)) {
      return res.status(500).json({
        message: `Streamlit app not found at ${appPath}.`,
      });
    }

    let resolved;
    try {
      resolved = await resolvePythonWithStreamlit();
    } catch (e) {
      if (e.message === "NO_PYTHON_STREAMLIT") {
        const hint =
          process.platform === "win32"
            ? " Install deps with npm run install-python-deps (from automl/backend), or py -3.12 -m pip install -r requirements.txt. Set PYTHON in .env to python.exe if py picks the wrong version."
            : "";
        return res.status(400).json({
          message: `No Python with Streamlit found.${hint}`,
          installCommand: process.platform === "win32" ? pipHintWin : pipHintUnix,
          requirementsPath,
          attempts: e.attempts,
        });
      }
      throw e;
    }

    const port = Number.parseInt(process.env.STREAMLIT_PORT || "8501", 10);
    const cwd = path.dirname(appPath);

    let pythonExe;
    try {
      pythonExe = await getResolvedPythonExecutable(resolved.exe, resolved.prefix);
    } catch (e) {
      return res.status(500).json({
        message: `Could not resolve Python executable: ${e.message}`,
        installCommand: process.platform === "win32" ? pipHintWin : pipHintUnix,
        requirementsPath,
      });
    }

    let runContext;
    try {
      runContext = await prepareStreamlitRunContext(req);
    } catch (e) {
      const status = e.status || 500;
      const map = {
        INVALID_RUN_ID: "Invalid run id.",
        RUN_NOT_FOUND: "Run not found.",
        RUN_NOT_COMPLETED: "This run is not completed yet. Wait for training to finish, then try again.",
        NO_MODEL_PATH: "No saved model for this run.",
        MODEL_FILE_MISSING: "Model file is missing on disk. Re-run the pipeline or restore generated files.",
      };
      return res.status(status).json({
        message: map[e.message] || e.message,
        requirementsPath,
      });
    }

    const childEnv = { ...envWithPythonScriptsFromExe(pythonExe), ...runContext.extras };

    try {
      await startStreamlitWithFallbacks(pythonExe, appPath, port, cwd, childEnv);
    } catch (spawnErr) {
      return res.status(500).json({
        message:
          spawnErr.message ||
          "Could not spawn Streamlit. Confirm pip install succeeded and PYTHON in .env points to that interpreter.",
        installCommand: process.platform === "win32" ? pipHintWin : pipHintUnix,
        requirementsPath,
        pythonUsed: pythonExe,
      });
    }

    try {
      await waitUntilStreamlitResponds(port);
    } catch (waitErr) {
      return res.status(503).json({
        message:
          waitErr.message === "STREAMLIT_START_TIMEOUT"
            ? `Streamlit did not respond on port ${port} in time. Another app may be using the port, or Streamlit crashed on startup. Try: ${process.platform === "win32" ? pipHintWin : pipHintUnix}`
            : waitErr.message,
        installCommand: process.platform === "win32" ? pipHintWin : pipHintUnix,
        requirementsPath,
        pythonUsed: pythonExe,
      });
    }

    const url = `http://127.0.0.1:${port}`;
    return res.json({
      ok: true,
      url,
      runId: String(req.body.runId),
      message: `Streamlit is ready at ${url} — prediction UI for this run’s saved model (Python: ${pythonExe}).`,
      python: pythonExe,
      streamlitVersion: resolved.streamlitVersion,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message || "Failed to start Streamlit.",
      installCommand: process.platform === "win32" ? pipHintWin : pipHintUnix,
      requirementsPath,
    });
  }
});

module.exports = router;
