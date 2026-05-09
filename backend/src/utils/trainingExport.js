/**
 * Builds tailored training script (.py) and Jupyter notebook (.ipynb) exports
 * from a completed run's report and feature metadata.
 */

function getModelImportLine(problemType, modelName) {
  const cls = {
    Logistic: "from sklearn.linear_model import LogisticRegression",
    SVM: "from sklearn.svm import SVC",
    KNN: "from sklearn.neighbors import KNeighborsClassifier",
    DecisionTree: "from sklearn.tree import DecisionTreeClassifier",
    RandomForest: "from sklearn.ensemble import RandomForestClassifier",
    GradientBoost: "from sklearn.ensemble import GradientBoostingClassifier",
    NaiveBayes: "from sklearn.naive_bayes import GaussianNB",
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

function computeTailoredExportContext(run) {
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
  const isFinalEnsemble =
    selectedVersion !== "improved" && dev2Choice.type === "ensemble" && members.length > 1;

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

  return {
    run,
    report,
    problemType,
    dev2Choice,
    selectedVersion,
    finalModelName,
    rowCount,
    featureCount,
    useIterative,
    usePca,
    usePoly,
    members,
    isFinalEnsemble,
    importSet,
    modelBuilder,
    numericImputerLine,
    engLine,
  };
}

function sharedHelperBlock(ctx) {
  const {
    useIterative,
    usePca,
    usePoly,
    modelBuilder,
    numericImputerLine,
    engLine,
    problemType,
    finalModelName,
    selectedVersion,
    rowCount,
    featureCount,
  } = ctx;
  return `TARGET_COL_DEFAULT = "${ctx.run.targetCol}"
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
`;
}

function buildTailoredTrainingScript(run) {
  const ctx = computeTailoredExportContext(run);
  const { importSet, useIterative } = ctx;

  const script = `${Array.from(importSet).join("\n")}


${sharedHelperBlock(ctx)}


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

  return script;
}

function notebookImportsMinimal(ctx) {
  const nbImports = new Set(ctx.importSet);
  nbImports.delete("import argparse");
  nbImports.add("%matplotlib inline");
  nbImports.add("from IPython.display import display, Image");
  nbImports.add("from pprint import pprint");
  nbImports.add("import pickle");
  nbImports.add("from functools import partial");
  nbImports.add("from sklearn.base import clone");
  nbImports.add("from sklearn.inspection import permutation_importance");
  nbImports.add(
    "from sklearn.metrics import ConfusionMatrixDisplay, average_precision_score, confusion_matrix, precision_recall_curve, roc_auc_score, roc_curve"
  );
  return Array.from(nbImports).join("\n");
}

function finalModelAssignmentPython(ctx) {
  const { problemType, isFinalEnsemble, members, finalModelName } = ctx;
  if (isFinalEnsemble && members.length > 1) {
    const estimatorLines = members
      .map((m) => `        ("${m}", ${getModelInstanceExpr(problemType, m)}),`)
      .join("\n");
    if (problemType === "classification") {
      return `model = StackingClassifier(
    estimators=[
${estimatorLines}
    ],
    final_estimator=LogisticRegression(max_iter=2000),
)`;
    }
    return `model = StackingRegressor(
    estimators=[
${estimatorLines}
    ],
    final_estimator=LinearRegression(),
)`;
  }
  return `model = ${getModelInstanceExpr(problemType, finalModelName)}`;
}

function engAssignmentPython(ctx) {
  if (ctx.usePca) {
    return `eng = Pipeline([("eng", PCA(n_components=min(20, x.shape[1])))])`;
  }
  if (ctx.usePoly) {
    return `eng = Pipeline([("eng", PolynomialFeatures(degree=2, include_bias=False))])`;
  }
  return `eng = "passthrough"`;
}

function metricsBlockPython(ctx) {
  if (ctx.problemType === "classification") {
    return `y_pred_train = pipe.predict(x_train)
y_pred_test = pipe.predict(x_test)
metrics = {
    "train_acc": accuracy_score(y_train, y_pred_train),
    "test_acc": accuracy_score(y_test, y_pred_test),
    "f1": f1_score(y_test, y_pred_test, average="weighted", zero_division=0),
    "precision": precision_score(y_test, y_pred_test, average="weighted", zero_division=0),
    "recall": recall_score(y_test, y_pred_test, average="weighted", zero_division=0),
}
pprint(metrics)`;
  }
  return `y_pred_train = pipe.predict(x_train)
y_pred_test = pipe.predict(x_test)
try:
    rmse = mean_squared_error(y_test, y_pred_test, squared=False)
except TypeError:
    rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))
metrics = {
    "train_r2": r2_score(y_train, y_pred_train),
    "test_r2": r2_score(y_test, y_pred_test),
    "mae": mean_absolute_error(y_test, y_pred_test),
    "rmse": float(rmse),
}
pprint(metrics)`;
}

/** Post-training plots aligned with dev1_data_pipeline._plot_final_model_visuals (+ train vs test acc for classification). */
function finalModelEvalVizPythonBlock(ctx) {
  const clsBlock = `y_pred_eval = pipe.predict(x_test)
labels_cm = np.unique(np.asarray(y_test))
cm = confusion_matrix(np.asarray(y_test), y_pred_eval, labels=labels_cm)
disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=labels_cm)
fig, ax = plt.subplots(figsize=(7, 6))
disp.plot(ax=ax, cmap="Blues", values_format="d", colorbar=False)
ax.set_title("Confusion Matrix (Test)")
p = viz_dir / "eval_confusion_matrix.png"
plt.tight_layout()
plt.savefig(p, dpi=150, bbox_inches="tight")
plt.close()
viz_paths.append(str(p))

if len(labels_cm) == 2 and hasattr(pipe, "predict_proba"):
    try:
        proba = pipe.predict_proba(x_test)[:, 1]
        fpr, tpr, _ = roc_curve(np.asarray(y_test), proba, pos_label=labels_cm[1])
        auc_score = roc_auc_score(np.asarray(y_test), proba)
        plt.figure(figsize=(6, 5))
        plt.plot(fpr, tpr, label=f"AUC = {auc_score:.3f}")
        plt.plot([0, 1], [0, 1], linestyle="--", color="gray")
        plt.xlabel("False Positive Rate")
        plt.ylabel("True Positive Rate")
        plt.title("ROC Curve (Test)")
        plt.legend(loc="lower right")
        p = viz_dir / "eval_roc_curve.png"
        plt.tight_layout()
        plt.savefig(p, dpi=150, bbox_inches="tight")
        plt.close()
        viz_paths.append(str(p))

        precision, recall, _ = precision_recall_curve(np.asarray(y_test), proba, pos_label=labels_cm[1])
        ap_score = average_precision_score(np.asarray(y_test), proba)
        plt.figure(figsize=(6, 5))
        plt.plot(recall, precision, label=f"AP = {ap_score:.3f}")
        plt.xlabel("Recall")
        plt.ylabel("Precision")
        plt.title("Precision-Recall Curve (Test)")
        plt.legend(loc="lower left")
        p = viz_dir / "eval_pr_curve.png"
        plt.tight_layout()
        plt.savefig(p, dpi=150, bbox_inches="tight")
        plt.close()
        viz_paths.append(str(p))
    except Exception:
        pass

mis_mask = np.asarray(y_pred_eval) != np.asarray(y_test)
if np.any(mis_mask):
    err = pd.DataFrame({"actual": np.asarray(y_test)[mis_mask], "predicted": np.asarray(y_pred_eval)[mis_mask]})
    top_err = (
        err.groupby(["actual", "predicted"])
        .size()
        .sort_values(ascending=False)
        .head(10)
        .reset_index(name="count")
    )
    top_err["pair"] = top_err["actual"].astype(str) + " -> " + top_err["predicted"].astype(str)
    plt.figure(figsize=(10, 4))
    sns.barplot(data=top_err, x="count", y="pair", orient="h")
    plt.title("Top Misclassification Patterns")
    plt.xlabel("Count")
    plt.ylabel("Actual -> Predicted")
    p = viz_dir / "eval_misclassification.png"
    plt.tight_layout()
    plt.savefig(p, dpi=150, bbox_inches="tight")
    plt.close()
    viz_paths.append(str(p))

train_acc_v = metrics.get("train_acc")
test_acc_v = metrics.get("test_acc")
if train_acc_v is not None and test_acc_v is not None:
    plt.figure(figsize=(6, 4))
    bars = plt.bar(["Training Accuracy", "Testing Accuracy"], [float(train_acc_v), float(test_acc_v)], color=["#60a5fa", "#2563eb"])
    plt.ylim(0, 1.05)
    plt.title("Training vs Testing Accuracy")
    plt.ylabel("Accuracy")
    for bar, value in zip(bars, [train_acc_v, test_acc_v]):
        plt.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.01,
            f"{float(value):.3f}",
            ha="center",
            va="bottom",
            fontsize=9,
        )
    p = viz_dir / "eval_train_vs_test_accuracy.png"
    plt.tight_layout()
    plt.savefig(p, dpi=150, bbox_inches="tight")
    plt.close()
    viz_paths.append(str(p))
`;

  const regBlock = `y_pred_train_eval = pipe.predict(x_train)
y_pred_test_eval = pipe.predict(x_test)
plt.figure(figsize=(7, 6))
plt.scatter(np.asarray(y_train), y_pred_train_eval, alpha=0.4, label="Train")
plt.scatter(np.asarray(y_test), y_pred_test_eval, alpha=0.6, label="Test")
low = min(float(np.min(y_train)), float(np.min(y_test)), float(np.min(y_pred_train_eval)), float(np.min(y_pred_test_eval)))
high = max(float(np.max(y_train)), float(np.max(y_test)), float(np.max(y_pred_train_eval)), float(np.max(y_pred_test_eval)))
plt.plot([low, high], [low, high], "r--", label="Ideal")
plt.xlabel("Actual")
plt.ylabel("Predicted")
plt.title("Actual vs Predicted (Train & Test)")
plt.legend()
p = viz_dir / "eval_actual_vs_predicted.png"
plt.tight_layout()
plt.savefig(p, dpi=150, bbox_inches="tight")
plt.close()
viz_paths.append(str(p))

residuals = np.asarray(y_test, dtype=float) - np.asarray(y_pred_test_eval, dtype=float)
plt.figure(figsize=(7, 5))
plt.scatter(y_pred_test_eval, residuals, alpha=0.6)
plt.axhline(0, color="red", linestyle="--")
plt.xlabel("Predicted")
plt.ylabel("Residual (Actual - Predicted)")
plt.title("Residual Plot (Test)")
p = viz_dir / "eval_residuals.png"
plt.tight_layout()
plt.savefig(p, dpi=150, bbox_inches="tight")
plt.close()
viz_paths.append(str(p))
`;

  const head = `viz_dir = Path("model_eval_visualizations")
viz_dir.mkdir(parents=True, exist_ok=True)
viz_paths = []
sns.set_theme(style="whitegrid")

snap = APP_SNAPSHOT
baseline_name = snap.get("baseline_model_name") or "Baseline (from app)"
baseline_m = snap.get("baseline_metrics") or {}

if PROBLEM_TYPE == "classification":
    b_score = float(baseline_m.get("test_acc") or 0.0)
    f_score = float(metrics.get("test_acc") or 0.0)
    metric_title = "Test Accuracy"
else:
    b_score = float(baseline_m.get("test_r2") or 0.0)
    f_score = float(metrics.get("test_r2") or 0.0)
    metric_title = "Test R2"

plt.figure(figsize=(8, 4))
bar_labels = [str(baseline_name), str(FINAL_MODEL_NAME)]
bar_vals = [b_score, f_score]
bar_colors = ["#9ecae1", "#3182bd"]
bars = plt.bar(bar_labels, bar_vals, color=bar_colors)
plt.title(f"Chosen Model ({metric_title})")
plt.ylabel(metric_title)
plt.xticks(rotation=10)
for bar, value in zip(bars, bar_vals):
    plt.text(
        bar.get_x() + bar.get_width() / 2,
        bar.get_height() + 0.01,
        f"{value:.4f}",
        ha="center",
        va="bottom",
        fontsize=10,
    )
p = viz_dir / "eval_chosen_model.png"
plt.tight_layout()
plt.savefig(p, dpi=150, bbox_inches="tight")
plt.close()
viz_paths.append(str(p))

if PROBLEM_TYPE == "classification":
    tr_s = metrics.get("train_acc")
    te_s = metrics.get("test_acc")
    mname = "Accuracy"
else:
    tr_s = metrics.get("train_r2")
    te_s = metrics.get("test_r2")
    mname = "R2"
if tr_s is not None and te_s is not None:
    tr_s = float(tr_s)
    te_s = float(te_s)
    plt.figure(figsize=(5, 4))
    sns.barplot(x=["Train", "Test"], y=[tr_s, te_s])
    plt.title(f"Overfitting Check ({mname})")
    if PROBLEM_TYPE == "classification":
        plt.ylim(min(tr_s, te_s) - 0.1, 1.05)
    else:
        plt.ylim(min(tr_s, te_s) - 0.15, max(tr_s, te_s) + 0.15)
    p = viz_dir / "eval_overfitting.png"
    plt.tight_layout()
    plt.savefig(p, dpi=150, bbox_inches="tight")
    plt.close()
    viz_paths.append(str(p))

scoring_perm = "f1_weighted" if PROBLEM_TYPE == "classification" else "r2"
try:
    perm = permutation_importance(pipe, x_test, y_test, n_repeats=5, random_state=42, scoring=scoring_perm)
    importances = pd.Series(perm.importances_mean, index=x_test.columns).sort_values(ascending=False)
    top_imp = importances.head(12).sort_values(ascending=True)
    labels = [str(name) for name in top_imp.index]
    plt.figure(figsize=(8, 5))
    ax = sns.barplot(x=top_imp.values, y=labels, orient="h")
    ax.set_ylabel("")
    plt.title("Permutation Feature Importance (Top Features)")
    plt.xlabel("Importance")
    p = viz_dir / "eval_permutation_importance.png"
    plt.tight_layout()
    plt.savefig(p, dpi=150, bbox_inches="tight")
    plt.close()
    viz_paths.append(str(p))
except Exception:
    pass

`;

  const tail = ctx.problemType === "classification" ? clsBlock : regBlock;
  return `${head}${tail}
print("Model evaluation figures:", viz_paths)
for path in viz_paths:
    display(Image(filename=path))`;
}

function edaVizPythonBlock() {
  return `eda_dir = Path("eda_visualizations")
eda_dir.mkdir(parents=True, exist_ok=True)
eda_paths = []
sns.set_theme(style="whitegrid")
eda_numeric = list(df.select_dtypes(include=[np.number]).columns)
eda_categorical = [c for c in df.columns if c not in eda_numeric]
eda_target = TARGET_COL

if len(eda_numeric) >= 2:
    corr = df[eda_numeric].corr(numeric_only=True)
    plt.figure(figsize=(8, 6))
    sns.heatmap(corr, cmap="coolwarm", center=0)
    plt.title("EDA: numeric correlation")
    p = eda_dir / "eda_01_correlation.png"
    plt.tight_layout()
    plt.savefig(p, dpi=150, bbox_inches="tight")
    plt.close()
    eda_paths.append(str(p))

plt.figure(figsize=(8, 4))
if eda_target in eda_numeric:
    sns.histplot(df[eda_target].dropna(), kde=True)
else:
    top_t = df[eda_target].astype(str).value_counts().head(20)
    sns.barplot(x=top_t.index, y=top_t.values)
    plt.xticks(rotation=45, ha="right")
plt.title("EDA: target distribution")
p = eda_dir / "eda_02_target.png"
plt.tight_layout()
plt.savefig(p, dpi=150, bbox_inches="tight")
plt.close()
eda_paths.append(str(p))

miss = (df.isnull().mean() * 100).sort_values(ascending=False).head(20)
plt.figure(figsize=(9, 4))
sns.barplot(x=miss.index, y=miss.values)
plt.xticks(rotation=45, ha="right")
plt.ylabel("Missing %")
plt.title("EDA: missing values by column")
p = eda_dir / "eda_03_missing.png"
plt.tight_layout()
plt.savefig(p, dpi=150, bbox_inches="tight")
plt.close()
eda_paths.append(str(p))

if eda_numeric:
    c0 = eda_numeric[0]
    plt.figure(figsize=(8, 4))
    sns.histplot(df[c0].dropna(), kde=True)
    plt.title(f"EDA: distribution of {c0}")
    p = eda_dir / "eda_04_feature_hist.png"
    plt.tight_layout()
    plt.savefig(p, dpi=150, bbox_inches="tight")
    plt.close()
    eda_paths.append(str(p))

num_no_t = [c for c in eda_numeric if c != eda_target]
if num_no_t:
    cx = num_no_t[0]
    plt.figure(figsize=(8, 4))
    if eda_target in eda_numeric:
        sns.scatterplot(data=df, x=cx, y=eda_target, alpha=0.6)
    else:
        sns.boxplot(data=df, x=eda_target, y=cx)
        plt.xticks(rotation=45, ha="right")
    plt.title(f"EDA: {cx} vs {eda_target}")
    p = eda_dir / "eda_05_feature_vs_target.png"
    plt.tight_layout()
    plt.savefig(p, dpi=150, bbox_inches="tight")
    plt.close()
    eda_paths.append(str(p))

if eda_categorical:
    cc = eda_categorical[0]
    top_c = df[cc].astype(str).value_counts().head(20)
    plt.figure(figsize=(9, 4))
    sns.barplot(x=top_c.index, y=top_c.values)
    plt.xticks(rotation=45, ha="right")
    plt.title(f"EDA: top values — {cc}")
    p = eda_dir / "eda_06_categorical.png"
    plt.tight_layout()
    plt.savefig(p, dpi=150, bbox_inches="tight")
    plt.close()
    eda_paths.append(str(p))

if len(eda_numeric) >= 2:
    sub = eda_numeric[: min(4, len(eda_numeric))]
    pdf = df[sub + ([eda_target] if eda_target in df.columns and eda_target not in sub else [])].dropna().head(300)
    if len(pdf) > 5:
        g = sns.pairplot(pdf, corner=True)
        g.fig.suptitle("EDA: pairwise (sample)", y=1.02)
        p = eda_dir / "eda_07_pairplot.png"
        g.savefig(p, dpi=150, bbox_inches="tight")
        plt.close("all")
        eda_paths.append(str(p))

while len(eda_paths) < 7:
    j = len(eda_paths) + 1
    plt.figure(figsize=(7, 3))
    plt.axis("off")
    plt.text(0.5, 0.5, f"EDA plot {j}\\n(insufficient columns)", ha="center", va="center", fontsize=12)
    p = eda_dir / f"eda_{j:02d}_placeholder.png"
    plt.tight_layout()
    plt.savefig(p, dpi=150, bbox_inches="tight")
    plt.close()
    eda_paths.append(str(p))

print("EDA figures:", eda_paths)
for path in eda_paths:
    display(Image(filename=path))`;
}

function toCellSource(code) {
  const normalized = code.endsWith("\n") ? code : `${code}\n`;
  return normalized.split("\n").map((line, i, arr) => (i < arr.length - 1 ? `${line}\n` : line));
}

function mdCell(text) {
  return {
    cell_type: "markdown",
    metadata: {},
    source: toCellSource(text),
  };
}

function codeCell(code) {
  return {
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs: [],
    source: toCellSource(code),
  };
}

function buildTailoredTrainingNotebook(run) {
  const ctx = computeTailoredExportContext(run);
  const {
    problemType,
    useIterative,
    usePca,
    usePoly,
    report,
    finalModelName,
    selectedVersion,
    rowCount,
    featureCount,
    numericImputerLine,
  } = ctx;

  const datasetHint = run.datasetFilename || "your_dataset.csv";
  const targetColJs = JSON.stringify(run.targetCol || "target");
  const preStrategy = useIterative
    ? "IterativeImputer + StandardScaler + OneHotEncoder"
    : "SimpleImputer + StandardScaler + OneHotEncoder";
  const feStrategy = usePca ? "PCA" : usePoly ? "PolynomialFeatures" : "passthrough";
  const dev2 = report.dev2 || {};
  const d2choice = dev2.choice || { type: "single", members: [] };
  const d2members = Array.isArray(d2choice.members) ? d2choice.members : [];
  const baselineModelName =
    d2choice.type === "ensemble" && d2members.length > 1
      ? `Ensemble (${d2members.join(", ")})`
      : d2members[0] || "Dev2 model";

  const snapshotJson = JSON.stringify({
    problem_type: problemType,
    target_col: run.targetCol,
    dataset_filename: run.datasetFilename || null,
    final_model: finalModelName,
    selected_version: selectedVersion,
    final_metrics_from_app: report.dev3?.final_metrics ?? null,
    baseline_model_name: baselineModelName,
    baseline_metrics: dev2.baseline_metrics ?? null,
    notebook_export_artifacts: {
      eda_visualization_directory: "eda_visualizations",
      model_eval_visualization_directory: "model_eval_visualizations",
      full_model_pickle_path: "tailored_full_pipeline.pkl",
      summary_json: "tailored_pipeline_report.json",
    },
  });

  const cells = [];

  cells.push(
    mdCell(
      `# Pipeline for this run\n\nNo helper \`def\` blocks: each step is a cell. After features are built, **EDA** plots go to \`eda_visualizations/\`. After training, **final model evaluation** plots (same kinds as in the app) go to \`model_eval_visualizations/\`. The pipeline is then **refit on all rows** and saved as a pickle. Edit \`FILE_PATH\` then run in order (CSV schema like \`${datasetHint}\`).`
    )
  );

  cells.push(codeCell(`${notebookImportsMinimal(ctx)}`));

  cells.push(
    mdCell(
      "## Reference from the app\n\nHold-out metrics stored after your AutoML run (compare with the notebook evaluation below)."
    )
  );
  cells.push(
    codeCell(`APP_SNAPSHOT = json.loads(${JSON.stringify(snapshotJson)})
pprint(APP_SNAPSHOT)
`
    )
  );

  cells.push(mdCell("## Pipeline constants (from this run)"));
  cells.push(
    codeCell(`PROBLEM_TYPE = ${JSON.stringify(problemType)}
FINAL_MODEL_NAME = ${JSON.stringify(finalModelName)}
SELECTED_VERSION = ${JSON.stringify(selectedVersion)}
ROW_COUNT = ${rowCount}
FEATURE_COUNT = ${featureCount}
PREPROCESSING_STRATEGY = ${JSON.stringify(preStrategy)}
FEATURE_ENGINEERING_STRATEGY = ${JSON.stringify(feStrategy)}
`
    )
  );

  cells.push(mdCell("## Load and clean data"));
  cells.push(
    codeCell(`FILE_PATH = ${JSON.stringify(datasetHint)}  # set to your CSV path
TARGET_COL = ${targetColJs}
df = pd.read_csv(FILE_PATH)
df.columns = [c.strip() for c in df.columns]
df = df.dropna(subset=[TARGET_COL]).drop_duplicates()
print("Shape:", df.shape)
display(df.head())
`
    )
  );

  cells.push(mdCell("## Features and target"));
  cells.push(
    codeCell(`x = df.drop(columns=[TARGET_COL])
y = df[TARGET_COL]
num_cols = list(x.select_dtypes(include=["int64", "float64"]).columns)
cat_cols = [c for c in x.columns if c not in num_cols]
print(len(num_cols), "numeric,", len(cat_cols), "categorical")
`
    )
  );

  cells.push(
    mdCell(
      "## EDA (preprocessing step)\n\nExploratory plots on the cleaned dataframe before fitting transformers (saved under `eda_visualizations/`)."
    )
  );
  cells.push(codeCell(edaVizPythonBlock()));

  cells.push(mdCell("## Preprocessing (chosen for this dataset only)"));
  cells.push(
    codeCell(`num_pipe = Pipeline(
    [
        ("writeable", FunctionTransformer(partial(np.array, copy=True), validate=False)),
        ${numericImputerLine}
        ("scaler", StandardScaler()),
    ]
)
cat_pipe = Pipeline(
    [
        ("writeable", FunctionTransformer(partial(np.array, copy=True), validate=False)),
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("encoder", OneHotEncoder(handle_unknown="ignore")),
    ]
)
pre = ColumnTransformer([("num", num_pipe, num_cols), ("cat", cat_pipe, cat_cols)])
`
    )
  );

  cells.push(mdCell("## Feature selection and engineering (chosen for this run)"));
  cells.push(
    codeCell(`selector = SelectKBest(score_func=${problemType === "classification" ? "f_classif" : "f_regression"}, k=min(10, x.shape[1]))
${engAssignmentPython(ctx)}
`
    )
  );

  cells.push(mdCell("## Final model"));
  cells.push(codeCell(finalModelAssignmentPython(ctx)));

  cells.push(mdCell("## Train/test split and fit"));
  cells.push(
    codeCell(`x_train, x_test, y_train, y_test = train_test_split(
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
        ("eng", eng),
        ("model", model),
    ]
)
pipe.fit(x_train, y_train)
print("Fitted:", FINAL_MODEL_NAME)
`
    )
  );

  cells.push(mdCell("## Hold-out evaluation"));
  cells.push(codeCell(metricsBlockPython(ctx)));

  cells.push(
    mdCell(
      "## Final model evaluation (same views as the app)\n\nBaseline vs final bar chart, train/test gap, permutation importance, then classification (confusion, ROC/PR if binary, misclassifications, train vs test accuracy) or regression (actual vs predicted, residuals). Figures under `model_eval_visualizations/`."
    )
  );
  cells.push(codeCell(finalModelEvalVizPythonBlock(ctx)));

  cells.push(mdCell("## Sample predictions"));
  cells.push(
    codeCell(`sample_x = x_test.head(5)
preds = pipe.predict(sample_x)
pred_df = pd.DataFrame({"y_true": y_test.head(5).values, "y_pred": preds})
if PROBLEM_TYPE == "classification" and hasattr(pipe, "predict_proba"):
    try:
        proba = pipe.predict_proba(sample_x)
        pred_df["max_proba"] = np.max(proba, axis=1)
    except Exception:
        pass
display(pred_df)
`
    )
  );

  cells.push(
    mdCell(
      "## Production model (full dataset)\n\nClone the same pipeline, **fit on all rows** (`x`, `y`), and save with pickle for inference outside the notebook."
    )
  );
  cells.push(
    codeCell(`FULL_MODEL_PICKLE_PATH = "tailored_full_pipeline.pkl"
pipe_full = clone(pipe)
pipe_full.fit(x, y)
with open(FULL_MODEL_PICKLE_PATH, "wb") as f:
    pickle.dump(pipe_full, f)
print("Saved:", FULL_MODEL_PICKLE_PATH, "| rows:", x.shape[0])
`
    )
  );

  cells.push(mdCell("## Save summary JSON (optional)"));
  cells.push(
    codeCell(`out_report = {
    "problem_type": PROBLEM_TYPE,
    "chosen_model": FINAL_MODEL_NAME,
    "selected_version": SELECTED_VERSION,
    "preprocessing_strategy": PREPROCESSING_STRATEGY,
    "feature_engineering_strategy": FEATURE_ENGINEERING_STRATEGY,
    "rows_after_cleaning_reference": ROW_COUNT,
    "feature_count_reference": FEATURE_COUNT,
    "target_col": TARGET_COL,
    "metrics": metrics,
    "eda_visualization_paths": eda_paths,
    "visualization_paths": viz_paths,
    "full_model_pickle_path": FULL_MODEL_PICKLE_PATH,
    "full_model_trained_on_rows": int(x.shape[0]),
}
with open("tailored_pipeline_report.json", "w", encoding="utf-8") as f:
    json.dump(out_report, f, indent=2, default=str)
print("Wrote tailored_pipeline_report.json")
`
    )
  );

  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: {
        name: "python",
        pygments_lexer: "ipython3",
        version: "3.10.0",
      },
    },
    cells,
  };

  return JSON.stringify(notebook, null, 2);
}

module.exports = {
  buildTailoredTrainingScript,
  buildTailoredTrainingNotebook,
};
