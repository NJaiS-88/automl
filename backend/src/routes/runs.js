const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { randomUUID } = require("crypto");

const RunHistory = require("../models/RunHistory");
const { requireAuth } = require("../middleware/auth");
const { readCsvPreview } = require("../services/csvService");
const {
  runPythonPipeline,
  runPythonPredict,
  runPythonVisualization,
} = require("../services/pipelineService");
const {
  buildTailoredTrainingScript,
  buildTailoredTrainingNotebook,
} = require("../utils/trainingExport");

const router = express.Router();

const uploadsDir = path.join(process.cwd(), "uploads");
const generatedDir = path.join(process.cwd(), "generated");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

function toGeneratedUrl(absPath) {
  const rel = path.relative(generatedDir, absPath).replace(/\\/g, "/");
  return `/generated/${rel}`;
}

function keepLastN(items, n = 7) {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length <= n) return arr;
  return arr.slice(-n);
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_e) {
    // ignore cleanup errors
  }
}

function cleanupRunArtifacts(run) {
  safeUnlink(run.datasetPath);
  safeUnlink(run.reportPath);
  safeUnlink(run.modelPath);
  safeUnlink(run.pythonScriptPath);
  const plotPaths = Array.isArray(run.plotPaths) ? run.plotPaths : [];
  for (const p of plotPaths) safeUnlink(p);
}

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const runs = await RunHistory.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(runs);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const run = await RunHistory.findOne({ _id: req.params.id, userId: req.user.id });
    if (!run) return res.status(404).json({ message: "Run not found" });
    res.json(run);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const { projectName } = req.body || {};
    if (!projectName || !String(projectName).trim()) {
      return res.status(400).json({ message: "projectName is required" });
    }
    const run = await RunHistory.findOne({ _id: req.params.id, userId: req.user.id });
    if (!run) return res.status(404).json({ message: "Run not found" });
    run.projectName = String(projectName).trim();
    await run.save();
    res.json(run);
  } catch (err) {
    next(err);
  }
});

router.get("/:id/progress", async (req, res, next) => {
  try {
    const run = await RunHistory.findOne({ _id: req.params.id, userId: req.user.id });
    if (!run) return res.status(404).json({ message: "Run not found" });
    res.json({
      runId: run._id,
      status: run.status,
      currentStage: run.currentStage || "pending",
      progressPct: typeof run.progressPct === "number" ? run.progressPct : 0,
      stageMessage: run.stageMessage || "",
      progressUpdatedAt: run.progressUpdatedAt || null,
      error: run.error || null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/execute", upload.single("dataset"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Dataset file is required" });
    const { targetCol, visualizations = "no" } = req.body;
    if (!targetCol) return res.status(400).json({ message: "targetCol is required" });

    const { columns, previewRows } = readCsvPreview(req.file.path);
    const run = await RunHistory.create({
      userId: req.user.id,
      name: req.file.originalname,
      projectName: req.file.originalname,
      datasetFilename: req.file.originalname,
      datasetPath: req.file.path,
      targetCol,
      visualizations: visualizations === "yes" ? "yes" : "no",
      status: "running",
      currentStage: "analyzing",
      progressPct: 10,
      stageMessage: "Analyzing your dataset...",
      progressUpdatedAt: new Date(),
      previewRows,
      featureColumns: columns,
    });

    const runKey = `${run._id}-${randomUUID()}`;
    const projectRoot = process.env.PROJECT_ROOT || path.resolve(process.cwd(), "..");

    // Return immediately so frontend can poll progress endpoint.
    res.status(202).json(run);

    (async () => {
      try {
        const result = await runPythonPipeline({
          projectRoot,
          datasetPath: req.file.path,
          targetCol,
          runId: runKey,
          visualizations: run.visualizations,
          onProgress: async (progress) => {
            run.currentStage = progress.currentStage || run.currentStage;
            run.progressPct =
              typeof progress.progressPct === "number" ? progress.progressPct : run.progressPct;
            run.stageMessage = progress.stageMessage || run.stageMessage;
            run.progressUpdatedAt = new Date();
            await run.save();
          },
        });

        run.status = "completed";
        run.currentStage = "finalize";
        run.progressPct = 100;
        run.stageMessage = "Pipeline completed successfully.";
        run.progressUpdatedAt = new Date();
        run.report = result.report;
        run.reportPath = result.report_path;
        run.modelPath = result.model_path;
        run.pythonScriptPath = result.python_script_path;
        run.plotPaths = keepLastN(result.plot_paths || []);
        run.plotUrls = keepLastN((result.plot_paths || []).map(toGeneratedUrl));
        run.featureColumns = result.feature_columns || columns;
        run.metricsSummary = result.report?.dev3?.final_metrics || null;
        run.logs = result.logs || "";
        await run.save();
      } catch (execErr) {
        run.status = "failed";
        run.currentStage = "failed";
        run.stageMessage = "Pipeline failed.";
        run.progressUpdatedAt = new Date();
        run.error = execErr.message;
        await run.save();
      }
    })();
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const run = await RunHistory.findOne({ _id: req.params.id, userId: req.user.id });
    if (!run) return res.status(404).json({ message: "Run not found" });
    cleanupRunArtifacts(run);
    await run.deleteOne();
    res.json({ message: "Run deleted successfully" });
  } catch (err) {
    next(err);
  }
});

router.delete("/", async (req, res, next) => {
  try {
    const runs = await RunHistory.find({ userId: req.user.id });
    runs.forEach((run) => cleanupRunArtifacts(run));
    const result = await RunHistory.deleteMany({ userId: req.user.id });
    res.json({ message: "History cleared successfully", deletedCount: result.deletedCount || 0 });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/predict", async (req, res, next) => {
  try {
    const run = await RunHistory.findOne({ _id: req.params.id, userId: req.user.id });
    if (!run) return res.status(404).json({ message: "Run not found" });
    if (!run.modelPath) return res.status(400).json({ message: "Model is unavailable." });

    const projectRoot = process.env.PROJECT_ROOT || path.resolve(process.cwd(), "..");
    const payload = req.body?.features || {};
    const prediction = await runPythonPredict({
      projectRoot,
      modelPath: run.modelPath,
      payload,
    });
    res.json(prediction);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/visualize", async (req, res, next) => {
  try {
    const run = await RunHistory.findOne({ _id: req.params.id, userId: req.user.id });
    if (!run) return res.status(404).json({ message: "Run not found" });
    if (!run.datasetPath) return res.status(400).json({ message: "Dataset is unavailable." });

    const {
      mode,
      plotTypes = [],
      xCol = null,
      yCol = null,
      singleCol = null,
      hueCol = null,
      multivariateCols = [],
    } = req.body || {};

    if (!mode || !Array.isArray(plotTypes) || plotTypes.length === 0) {
      return res.status(400).json({ message: "mode and at least one plot type are required." });
    }

    const projectRoot = process.env.PROJECT_ROOT || path.resolve(process.cwd(), "..");
    const result = await runPythonVisualization({
      projectRoot,
      datasetPath: run.datasetPath,
      runId: String(run._id),
      payload: {
        mode,
        plotTypes,
        xCol,
        yCol,
        singleCol,
        hueCol,
        multivariateCols,
      },
    });
    const plotUrls = (result.plot_paths || []).map(toGeneratedUrl);
    res.json({ plotUrls, errors: result.errors || [] });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/plots/add", async (req, res, next) => {
  try {
    const run = await RunHistory.findOne({ _id: req.params.id, userId: req.user.id });
    if (!run) return res.status(404).json({ message: "Run not found" });

    const incomingPlotUrls = Array.isArray(req.body?.plotUrls) ? req.body.plotUrls : [];
    const validUrls = incomingPlotUrls.filter(
      (url) => typeof url === "string" && url.startsWith("/generated/")
    );
    if (!validUrls.length) {
      return res.status(400).json({ message: "No valid plotUrls provided." });
    }

    const existingUrls = Array.isArray(run.plotUrls) ? run.plotUrls : [];
    const existingPaths = Array.isArray(run.plotPaths) ? run.plotPaths : [];
    const nextUrls = Array.from(new Set([...existingUrls, ...validUrls]));

    const derivedPaths = validUrls.map((url) => {
      const rel = url.replace(/^\/generated\//, "");
      return path.join(generatedDir, rel);
    });
    const nextPaths = Array.from(new Set([...existingPaths, ...derivedPaths]));

    run.plotUrls = nextUrls;
    run.plotPaths = nextPaths;
    await run.save();

    res.json({ plotUrls: run.plotUrls });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/download-training-script", async (req, res, next) => {
  try {
    const run = await RunHistory.findOne({ _id: req.params.id, userId: req.user.id });
    if (!run) return res.status(404).json({ message: "Run not found" });
    const script = buildTailoredTrainingScript(run);
    res.setHeader("Content-Type", "text/x-python");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=tailored_${(run.targetCol || "model").replace(/\s+/g, "_")}.py`
    );
    res.send(script);
  } catch (err) {
    next(err);
  }
});

router.get("/:id/download-training-notebook", async (req, res, next) => {
  try {
    const run = await RunHistory.findOne({ _id: req.params.id, userId: req.user.id });
    if (!run) return res.status(404).json({ message: "Run not found" });
    const body = buildTailoredTrainingNotebook(run);
    const base = (run.targetCol || "model").replace(/\s+/g, "_");
    res.setHeader("Content-Type", "application/x-ipynb+json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=tailored_${base}.ipynb`);
    res.send(body);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
