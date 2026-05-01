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

function getModelImportLine(problemType, modelName) {
  const cls = {
    Logistic: "from sklearn.linear_model import LogisticRegression",
    SVM: "from sklearn.svm import SVC",
    KNN: "from sklearn.neighbors import KNeighborsClassifier",
    DecisionTree: "from sklearn.tree import DecisionTreeClassifier",
    RandomForest: "from sklearn.ensemble import RandomForestClassifier",
    GradientBoost: "from sklearn.ensemble import GradientBoostingClassifier",
    NaiveBayes: "from sklearn.naive_bayes import GaussianNB",
    BalancedRF: "from sklearn.ensemble import RandomForestClassifier",
  };
  const reg = {
    Linear: "from sklearn.linear_model import LinearRegression",
    SVR: "from sklearn.svm import SVR",
    KNN: "from sklearn.neighbors import KNeighborsRegressor",
    DecisionTree: "from sklearn.tree import DecisionTreeRegressor",
    RandomForest: "from sklearn.ensemble import RandomForestRegressor",
    GradientBoost: "from sklearn.ensemble import GradientBoostingRegressor",
  };
  return (problemType === "classification" ? cls : reg)[modelName];
}

function getModelInstanceExpr(problemType, modelName) {
  const cls = {
    Logistic: "LogisticRegression(max_iter=2000)",
    SVM: "SVC(probability=True)",
    KNN: "KNeighborsClassifier()",
    DecisionTree: "DecisionTreeClassifier()",
    RandomForest: "RandomForestClassifier()",
    GradientBoost: "GradientBoostingClassifier()",
    NaiveBayes: "GaussianNB()",
    BalancedRF: "RandomForestClassifier(class_weight='balanced')",
  };
  const reg = {
    Linear: "LinearRegression()",
    SVR: "SVR()",
    KNN: "KNeighborsRegressor()",
    DecisionTree: "DecisionTreeRegressor()",
    RandomForest: "RandomForestRegressor()",
    GradientBoost: "GradientBoostingRegressor()",
  };
  return (problemType === "classification" ? cls : reg)[modelName];
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
    const report = run.report || {};
    const problemType = report.problem_type || "classification";
    const dev2Choice = report.dev2?.choice || { type: "single", members: [] };
    const selectedVersion = report.dev3?.selected_model_version || "original";
    const bestCandidateName = report.dev3?.best_candidate_name || null;
    const finalModelName =
      selectedVersion === "improved" && bestCandidateName
        ? bestCandidateName
        : dev2Choice.type === "single" && dev2Choice.members?.length
          ? dev2Choice.members[0]
          : "Ensemble";
    const rowCount = report.data_report?.rows_after_cleaning || 0;
    const featureCount = run.featureColumns?.length || 0;
    const useIterative = rowCount > 0 && rowCount < 2000;
    const usePca = rowCount <= 5000 && featureCount > 20;
    const usePoly = rowCount <= 5000 && featureCount < 15;

    const members = Array.isArray(dev2Choice.members) ? dev2Choice.members : [];
    const isFinalEnsemble = selectedVersion !== "improved" && dev2Choice.type === "ensemble" && members.length > 1;

    const importSet = new Set([
      "import argparse",
      "import json",
      "from pathlib import Path",
      "import pandas as pd",
      "import numpy as np",
      "import matplotlib.pyplot as plt",
      "import seaborn as sns",
      "from sklearn.model_selection import train_test_split",
      "from sklearn.pipeline import Pipeline",
      "from sklearn.compose import ColumnTransformer",
      "from sklearn.preprocessing import FunctionTransformer, StandardScaler, OneHotEncoder",
      "from sklearn.impute import SimpleImputer",
      "from sklearn.feature_selection import SelectKBest, f_classif, f_regression",
      "from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, r2_score, mean_absolute_error, mean_squared_error",
    ]);
    if (useIterative) {
      importSet.add("from sklearn.experimental import enable_iterative_imputer  # noqa: F401");
      importSet.add("from sklearn.impute import IterativeImputer");
    }
    if (usePca) importSet.add("from sklearn.decomposition import PCA");
    if (usePoly) importSet.add("from sklearn.preprocessing import PolynomialFeatures");

    if (isFinalEnsemble) {
      importSet.add(
        problemType === "classification"
          ? "from sklearn.ensemble import StackingClassifier"
          : "from sklearn.ensemble import StackingRegressor"
      );
      importSet.add(
        problemType === "classification"
          ? "from sklearn.linear_model import LogisticRegression"
          : "from sklearn.linear_model import LinearRegression"
      );
      members.forEach((m) => {
        const imp = getModelImportLine(problemType, m);
        if (imp) importSet.add(imp);
      });
    } else {
      const imp = getModelImportLine(problemType, finalModelName);
      if (imp) importSet.add(imp);
    }

    let modelBuilder = "";
    if (isFinalEnsemble) {
      const estimatorLines = members
        .map((m) => `        ("${m}", ${getModelInstanceExpr(problemType, m)}),`)
        .join("\n");
      modelBuilder = `def build_final_model():
    estimators = [
${estimatorLines}
    ]
    ${
      problemType === "classification"
        ? "return StackingClassifier(estimators=estimators, final_estimator=LogisticRegression(max_iter=2000))"
        : "return StackingRegressor(estimators=estimators, final_estimator=LinearRegression())"
    }
`;
    } else {
      modelBuilder = `def build_final_model():
    return ${getModelInstanceExpr(problemType, finalModelName)}
`;
    }

    const numericImputerLine = useIterative
      ? '("imputer", IterativeImputer(initial_strategy="median")),'
      : '("imputer", SimpleImputer(strategy="median")),';
    const engLine = usePca
      ? '("eng", PCA(n_components=min(20, x.shape[1]))),'
      : usePoly
        ? '("eng", PolynomialFeatures(degree=2, include_bias=False)),'
        : '("eng", "passthrough"),';

    const script = `${Array.from(importSet).join("\n")}


TARGET_COL_DEFAULT = "${run.targetCol}"
PROBLEM_TYPE = "${problemType}"
FINAL_MODEL_NAME = "${finalModelName}"
SELECTED_VERSION = "${selectedVersion}"
ROW_COUNT = ${rowCount}
FEATURE_COUNT = ${featureCount}
PREPROCESSING_STRATEGY = "${useIterative ? "IterativeImputer + StandardScaler + OneHotEncoder" : "SimpleImputer + StandardScaler + OneHotEncoder"}"
FEATURE_ENGINEERING_STRATEGY = "${usePca ? "PCA" : usePoly ? "PolynomialFeatures" : "passthrough"}"


def _ensure_writeable_array(x):
    return np.array(x, copy=True)


def split_features_target(df, target_col):
    x = df.drop(columns=[target_col])
    y = df[target_col]
    return x, y


def infer_column_types(x):
    num_cols = list(x.select_dtypes(include=["int64", "float64"]).columns)
    cat_cols = [c for c in x.columns if c not in num_cols]
    return num_cols, cat_cols


def build_preprocessor(num_cols, cat_cols, use_iterative=False):
    num_pipe = Pipeline(
        [
            ("writeable", FunctionTransformer(_ensure_writeable_array, validate=False)),
            ${numericImputerLine}
            ("scaler", StandardScaler()),
        ]
    )
    cat_pipe = Pipeline(
        [
            ("writeable", FunctionTransformer(_ensure_writeable_array, validate=False)),
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore")),
        ]
    )
    return ColumnTransformer([("num", num_pipe, num_cols), ("cat", cat_pipe, cat_cols)])


def get_feature_selector(problem_type, x):
    k = min(10, x.shape[1])
    return SelectKBest(score_func=f_classif if problem_type == "classification" else f_regression, k=k)


def build_feature_engineering(x):
    return Pipeline([
        ${engLine}
    ]) if FEATURE_ENGINEERING_STRATEGY != "passthrough" else "passthrough"


${modelBuilder}


def evaluate(pipe, x_train, x_test, y_train, y_test, problem_type):
    y_pred_train = pipe.predict(x_train)
    y_pred_test = pipe.predict(x_test)
    if problem_type == "classification":
        return {
            "train_acc": accuracy_score(y_train, y_pred_train),
            "test_acc": accuracy_score(y_test, y_pred_test),
            "f1": f1_score(y_test, y_pred_test, average="weighted", zero_division=0),
            "precision": precision_score(y_test, y_pred_test, average="weighted", zero_division=0),
            "recall": recall_score(y_test, y_pred_test, average="weighted", zero_division=0),
        }
    try:
        rmse = mean_squared_error(y_test, y_pred_test, squared=False)
    except TypeError:
        rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))
    return {
        "train_r2": r2_score(y_train, y_pred_train),
        "test_r2": r2_score(y_test, y_pred_test),
        "mae": mean_absolute_error(y_test, y_pred_test),
        "rmse": float(rmse),
    }


def generate_visualizations(df, target_col, output_dir):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    saved_paths = []
    sns.set_theme(style="whitegrid")
    numeric_cols = list(df.select_dtypes(include=[np.number]).columns)
    categorical_cols = [c for c in df.columns if c not in numeric_cols]

    def _save_current(name):
        out_path = output_dir / name
        plt.tight_layout()
        plt.savefig(out_path, dpi=150, bbox_inches="tight")
        plt.close()
        saved_paths.append(str(out_path))

    # 1) Heatmap
    if len(numeric_cols) >= 2:
        corr = df[numeric_cols].corr(numeric_only=True)
        plt.figure(figsize=(8, 6))
        sns.heatmap(corr, cmap="coolwarm", center=0)
        _save_current("viz_01_heatmap.png")

    # 2) Target distribution
    plt.figure(figsize=(8, 4))
    if target_col in numeric_cols:
        sns.histplot(df[target_col].dropna(), kde=True)
    else:
        top_target = df[target_col].astype(str).value_counts().head(20)
        sns.barplot(x=top_target.index, y=top_target.values)
        plt.xticks(rotation=45, ha="right")
    plt.title("Target distribution")
    _save_current("viz_02_target_distribution.png")

    # 3) Missing values
    missing_pct = (df.isnull().mean() * 100).sort_values(ascending=False).head(20)
    plt.figure(figsize=(9, 4))
    sns.barplot(x=missing_pct.index, y=missing_pct.values)
    plt.xticks(rotation=45, ha="right")
    plt.ylabel("Missing %")
    plt.title("Top missing-value columns")
    _save_current("viz_03_missing_values.png")

    # 4) Numeric feature distribution
    if numeric_cols:
        chosen = numeric_cols[0]
        plt.figure(figsize=(8, 4))
        sns.histplot(df[chosen].dropna(), kde=True)
        plt.title(f"Distribution: {chosen}")
        _save_current("viz_04_numeric_distribution.png")

    # 5) Numeric vs target
    num_no_target = [c for c in numeric_cols if c != target_col]
    if num_no_target:
        chosen_x = num_no_target[0]
        plt.figure(figsize=(8, 4))
        if target_col in numeric_cols:
            sns.scatterplot(data=df, x=chosen_x, y=target_col, alpha=0.6)
        else:
            sns.boxplot(data=df, x=target_col, y=chosen_x)
            plt.xticks(rotation=45, ha="right")
        plt.title(f"{chosen_x} vs {target_col}")
        _save_current("viz_05_feature_vs_target.png")

    # 6) Categorical count
    if categorical_cols:
        chosen_cat = categorical_cols[0]
        top_cat = df[chosen_cat].astype(str).value_counts().head(20)
        plt.figure(figsize=(9, 4))
        sns.barplot(x=top_cat.index, y=top_cat.values)
        plt.xticks(rotation=45, ha="right")
        plt.title(f"Top values: {chosen_cat}")
        _save_current("viz_06_categorical_count.png")

    # 7) Pairplot (sampled)
    if len(numeric_cols) >= 2:
        subset = numeric_cols[: min(4, len(numeric_cols))]
        pair_df = df[subset + ([target_col] if target_col in df.columns and target_col not in subset else [])].dropna().head(300)
        if len(pair_df) > 5:
            g = sns.pairplot(pair_df, corner=True)
            g.fig.suptitle("Pairwise relationships", y=1.02)
            out_path = output_dir / "viz_07_pairplot.png"
            g.savefig(out_path, dpi=150, bbox_inches="tight")
            plt.close("all")
            saved_paths.append(str(out_path))

    # Ensure script always returns exactly 7 visualizations.
    while len(saved_paths) < 7:
        idx = len(saved_paths) + 1
        plt.figure(figsize=(7, 3))
        plt.axis("off")
        plt.text(
            0.5,
            0.5,
            f"Visualization {idx}\\nNot enough compatible columns for a richer plot.",
            ha="center",
            va="center",
            fontsize=12,
        )
        _save_current(f"viz_{idx:02d}_placeholder.png")

    return saved_paths


def main():
    parser = argparse.ArgumentParser(description="Tailored single-model pipeline script")
    parser.add_argument("--file-path", required=True, help="CSV dataset path")
    parser.add_argument("--target-col", default=TARGET_COL_DEFAULT)
    parser.add_argument("--output-json", default="tailored_pipeline_report.json")
    args = parser.parse_args()

    df = pd.read_csv(args.file_path)
    df.columns = [c.strip() for c in df.columns]
    df = df.dropna(subset=[args.target_col]).drop_duplicates()

    x, y = split_features_target(df, args.target_col)
    num_cols, cat_cols = infer_column_types(x)

    pre = build_preprocessor(num_cols, cat_cols, use_iterative=${useIterative ? "True" : "False"})
    selector = get_feature_selector(PROBLEM_TYPE, x)
    model = build_final_model()

    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=0.2,
        random_state=42,
        stratify=y if PROBLEM_TYPE == "classification" and y.value_counts().min() >= 2 else None,
    )

    pipe = Pipeline(
        [
            ("pre", pre),
            ("feat", selector),
            ("eng", build_feature_engineering(x)),
            ("model", model),
        ]
    )
    pipe.fit(x_train, y_train)
    metrics = evaluate(pipe, x_train, x_test, y_train, y_test, PROBLEM_TYPE)

    report = {
        "problem_type": PROBLEM_TYPE,
        "chosen_model": FINAL_MODEL_NAME,
        "selected_version": SELECTED_VERSION,
        "preprocessing_strategy": PREPROCESSING_STRATEGY,
        "feature_engineering_strategy": FEATURE_ENGINEERING_STRATEGY,
        "rows_after_cleaning_reference": ROW_COUNT,
        "feature_count_reference": FEATURE_COUNT,
        "target_col": args.target_col,
        "metrics": metrics,
    }
    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)

    viz_paths = generate_visualizations(df, args.target_col, "generated_visualizations")
    report["visualization_paths"] = viz_paths
    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)

    print("Tailored pipeline completed.")
    print("Chosen model:", FINAL_MODEL_NAME)
    print("Metrics:", metrics)
    print("Report saved to:", args.output_json)


if __name__ == "__main__":
    main()
`;

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

module.exports = router;
