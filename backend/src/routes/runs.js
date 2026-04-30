const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const RunHistory = require("../models/RunHistory");
const { requireAuth } = require("../middleware/auth");
const { readCsvPreview } = require("../services/csvService");
const { runPythonPipeline, runPythonPredict } = require("../services/pipelineService");

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

router.post("/execute", upload.single("dataset"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Dataset file is required" });
    const { targetCol, visualizations = "no" } = req.body;
    if (!targetCol) return res.status(400).json({ message: "targetCol is required" });

    const { columns, previewRows } = readCsvPreview(req.file.path);
    const run = await RunHistory.create({
      userId: req.user.id,
      name: req.file.originalname,
      datasetFilename: req.file.originalname,
      datasetPath: req.file.path,
      targetCol,
      visualizations: visualizations === "yes" ? "yes" : "no",
      status: "running",
      previewRows,
      featureColumns: columns,
    });

    const runKey = `${run._id}-${uuidv4()}`;
    const projectRoot = process.env.PROJECT_ROOT || path.resolve(process.cwd(), "..");

    try {
      const result = await runPythonPipeline({
        projectRoot,
        datasetPath: req.file.path,
        targetCol,
        runId: runKey,
        visualizations: run.visualizations,
      });

      run.status = "completed";
      run.report = result.report;
      run.reportPath = result.report_path;
      run.modelPath = result.model_path;
      run.pythonScriptPath = result.python_script_path;
      run.plotPaths = result.plot_paths || [];
      run.plotUrls = (result.plot_paths || []).map(toGeneratedUrl);
      run.featureColumns = result.feature_columns || columns;
      run.metricsSummary = result.report?.dev3?.final_metrics || null;
      run.logs = result.logs || "";
      await run.save();
      res.json(run);
    } catch (execErr) {
      run.status = "failed";
      run.error = execErr.message;
      await run.save();
      res.status(500).json({ message: execErr.message, runId: run._id });
    }
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
      "import pandas as pd",
      "import numpy as np",
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
    return {
        "train_r2": r2_score(y_train, y_pred_train),
        "test_r2": r2_score(y_test, y_pred_test),
        "mae": mean_absolute_error(y_test, y_pred_test),
        "rmse": mean_squared_error(y_test, y_pred_test, squared=False),
    }


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
