from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Tuple

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    average_precision_score,
    confusion_matrix,
    precision_recall_curve,
    roc_auc_score,
    roc_curve,
)
from sklearn.pipeline import Pipeline

from dev2_automl_doctor import (
    build_ensemble,
    build_preprocessor,
    detect_problem_type,
    evaluate,
    final_training,
    get_feature_selector,
    infer_column_types,
    load_csv,
    smart_model_selector,
    split_features_target,
    train_models_core,
)
from dev3_auto_optimization import optimize_model
from dev0 import run_eda


def _convert_numpy(value: Any) -> Any:
    if isinstance(value, (np.floating, np.integer, np.bool_)):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value


def _sanitize_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    return {key: _convert_numpy(value) for key, value in data.items()}


def _extract_model_name(model: Any) -> str:
    if isinstance(model, Pipeline) and "model" in model.named_steps:
        return model.named_steps["model"].__class__.__name__
    return model.__class__.__name__


def _plot_classification_end_charts(model, X_test, y_test) -> None:
    y_pred = model.predict(X_test)
    labels = np.unique(y_test)
    cm = confusion_matrix(y_test, y_pred, labels=labels)
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=labels)
    fig, ax = plt.subplots(figsize=(7, 6))
    disp.plot(ax=ax, cmap="Blues", values_format="d", colorbar=False)
    ax.set_title("Confusion Matrix (Test)")
    plt.tight_layout()
    plt.show()

    # Optional ROC for binary classification when probabilities are available.
    if len(labels) == 2 and hasattr(model, "predict_proba"):
        try:
            proba = model.predict_proba(X_test)[:, 1]
            fpr, tpr, _ = roc_curve(y_test, proba, pos_label=labels[1])
            auc_score = roc_auc_score(y_test, proba)
            plt.figure(figsize=(6, 5))
            plt.plot(fpr, tpr, label=f"AUC = {auc_score:.3f}")
            plt.plot([0, 1], [0, 1], linestyle="--", color="gray")
            plt.xlabel("False Positive Rate")
            plt.ylabel("True Positive Rate")
            plt.title("ROC Curve (Test)")
            plt.legend(loc="lower right")
            plt.tight_layout()
            plt.show()

            precision, recall, _ = precision_recall_curve(y_test, proba, pos_label=labels[1])
            ap_score = average_precision_score(y_test, proba)
            plt.figure(figsize=(6, 5))
            plt.plot(recall, precision, label=f"AP = {ap_score:.3f}")
            plt.xlabel("Recall")
            plt.ylabel("Precision")
            plt.title("Precision-Recall Curve (Test)")
            plt.legend(loc="lower left")
            plt.tight_layout()
            plt.show()
        except Exception:
            pass

    # Quick misclassification view (top error classes).
    mis_mask = y_pred != y_test
    if np.any(mis_mask):
        err = pd.DataFrame({"actual": y_test[mis_mask], "predicted": y_pred[mis_mask]})
        top_err = (
            err.groupby(["actual", "predicted"])
            .size()
            .sort_values(ascending=False)
            .head(10)
            .reset_index(name="count")
        )
        plt.figure(figsize=(10, 4))
        sns.barplot(
            data=top_err,
            x="count",
            y=top_err.apply(lambda r: f"{r['actual']} -> {r['predicted']}", axis=1),
            orient="h",
        )
        plt.title("Top Misclassification Patterns")
        plt.xlabel("Count")
        plt.ylabel("Actual -> Predicted")
        plt.tight_layout()
        plt.show()


def _plot_regression_end_charts(model, X_train, X_test, y_train, y_test) -> None:
    y_pred_train = model.predict(X_train)
    y_pred_test = model.predict(X_test)

    # 1) Train/Test scatter against ideal fit line.
    plt.figure(figsize=(7, 6))
    plt.scatter(y_train, y_pred_train, alpha=0.4, label="Train")
    plt.scatter(y_test, y_pred_test, alpha=0.6, label="Test")
    low = min(np.min(y_train), np.min(y_test), np.min(y_pred_train), np.min(y_pred_test))
    high = max(np.max(y_train), np.max(y_test), np.max(y_pred_train), np.max(y_pred_test))
    plt.plot([low, high], [low, high], "r--", label="Ideal")
    plt.xlabel("Actual")
    plt.ylabel("Predicted")
    plt.title("Actual vs Predicted (Train & Test)")
    plt.legend()
    plt.tight_layout()
    plt.show()

    # 3) Residual plot
    residuals = np.array(y_test) - np.array(y_pred_test)
    plt.figure(figsize=(7, 5))
    plt.scatter(y_pred_test, residuals, alpha=0.6)
    plt.axhline(0, color="red", linestyle="--")
    plt.xlabel("Predicted")
    plt.ylabel("Residual (Actual - Predicted)")
    plt.title("Residual Plot (Test)")
    plt.tight_layout()
    plt.show()


def _plot_overfitting_check(final_metrics: Dict[str, Any], problem_type: str) -> None:
    if problem_type == "classification":
        train_score = final_metrics.get("train_acc")
        test_score = final_metrics.get("test_acc")
        metric_name = "Accuracy"
    else:
        train_score = final_metrics.get("train_r2")
        test_score = final_metrics.get("test_r2")
        metric_name = "R2"

    if train_score is None or test_score is None:
        return

    plt.figure(figsize=(5, 4))
    sns.barplot(x=["Train", "Test"], y=[train_score, test_score])
    plt.title(f"Overfitting Check ({metric_name})")
    plt.ylim(min(train_score, test_score) - 0.1, 1.05)
    plt.tight_layout()
    plt.show()


def _plot_feature_importance(model, X_test, y_test, problem_type: str) -> None:
    scoring = "accuracy" if problem_type == "classification" else "r2"
    try:
        perm = permutation_importance(
            model, X_test, y_test, n_repeats=5, random_state=42, scoring=scoring
        )
        importances = pd.Series(perm.importances_mean, index=X_test.columns).sort_values(
            ascending=False
        )
        top = importances.head(12).sort_values(ascending=True)
        plt.figure(figsize=(8, 5))
        sns.barplot(x=top.values, y=top.index, orient="h")
        plt.title("Permutation Feature Importance (Top Features)")
        plt.xlabel("Importance")
        plt.tight_layout()
        plt.show()
    except Exception:
        pass


def _plot_chosen_model_chart(
    baseline_model_name: str,
    final_model_name: str,
    baseline_metrics: Dict[str, Any],
    final_metrics: Dict[str, Any],
    problem_type: str,
) -> None:
    if problem_type == "classification":
        baseline_score = baseline_metrics.get("test_acc", 0.0)
        final_score = final_metrics.get("test_acc", 0.0)
        metric_name = "Test Accuracy"
    else:
        baseline_score = baseline_metrics.get("test_r2", 0.0)
        final_score = final_metrics.get("test_r2", 0.0)
        metric_name = "Test R2"

    labels = [f"{baseline_model_name}", f"{final_model_name}"]
    values = [baseline_score, final_score]
    colors = ["#9ecae1", "#3182bd"]

    plt.figure(figsize=(8, 4))
    bars = plt.bar(labels, values, color=colors)
    plt.title(f"Chosen Model ({metric_name})")
    plt.ylabel(metric_name)
    plt.xticks(rotation=10)
    for bar, value in zip(bars, values):
        plt.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.01,
            f"{value:.4f}",
            ha="center",
            va="bottom",
            fontsize=10,
        )
    plt.tight_layout()
    plt.show()


def _plot_final_model_visuals(
    baseline_model_name: str,
    final_model,
    problem_type: str,
    baseline_metrics: Dict[str, Any],
    final_metrics,
    X_train,
    X_test,
    y_train,
    y_test,
) -> None:
    print("\nFINAL VISUALIZATIONS")
    final_model_name = _extract_model_name(final_model)
    print(f"Final model: {final_model_name}")
    _plot_chosen_model_chart(
        baseline_model_name=baseline_model_name,
        final_model_name=final_model_name,
        baseline_metrics=baseline_metrics,
        final_metrics=final_metrics,
        problem_type=problem_type,
    )
    _plot_overfitting_check(final_metrics, problem_type)
    _plot_feature_importance(final_model, X_test, y_test, problem_type)
    if problem_type == "classification":
        _plot_classification_end_charts(final_model, X_test, y_test)
    else:
        _plot_regression_end_charts(final_model, X_train, X_test, y_train, y_test)


def _resolve_target_column(df: pd.DataFrame, target_col: str) -> str:
    if target_col in df.columns:
        return target_col

    normalized_target = target_col.strip().lower()
    matches = [col for col in df.columns if col.strip().lower() == normalized_target]

    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError(
            f"Target column '{target_col}' is ambiguous. Matching columns: {matches}"
        )

    # Fallback for datasets with malformed/implicit headers (common in checkpoints/exports).
    # If the requested target name is a common alias, use the last column.
    common_target_aliases = {
        "target",
        "label",
        "class",
        "species",
        "churn",
        "outcome",
        "y",
    }
    if normalized_target in common_target_aliases and len(df.columns) > 1:
        fallback_col = df.columns[-1]
        print(
            f"⚠️ Target '{target_col}' not found; using last column '{fallback_col}' as fallback target."
        )
        return fallback_col

    raise ValueError(
        f"Target column '{target_col}' not found. Available columns: {list(df.columns)}"
    )


def run_dev1_data_pipeline(df: pd.DataFrame, target_col: str) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    target_col = _resolve_target_column(df, target_col)

    original_rows = len(df)
    missing_target_rows = int(df[target_col].isna().sum())
    duplicate_rows = int(df.duplicated().sum())

    clean_df = df.copy()
    clean_df = clean_df.dropna(subset=[target_col])
    clean_df = clean_df.drop_duplicates()

    if clean_df.empty:
        raise ValueError("Dataset is empty after removing rows with missing target/duplicates.")

    report = {
        "original_rows": original_rows,
        "rows_after_cleaning": len(clean_df),
        "removed_missing_target_rows": missing_target_rows,
        "removed_duplicate_rows": duplicate_rows,
        "columns": list(clean_df.columns),
    }
    return clean_df, report


def _select_best_dev2_model(scores: Dict[str, Dict[str, float]], problem_type: str):
    if problem_type == "classification":
        ranked = sorted(
            ((name, metric["f1_weighted"]) for name, metric in scores.items()),
            key=lambda item: item[1],
            reverse=True,
        )
    else:
        ranked = sorted(
            ((name, metric["r2"]) for name, metric in scores.items()),
            key=lambda item: item[1],
            reverse=True,
        )

    if not ranked:
        raise RuntimeError("Dev2 could not produce model scores.")

    top_model_names = [name for name, _ in ranked[:4]]
    return ranked, top_model_names


def run_full_pipeline(file_path: str, target_col: str, random_state: int = 42) -> Dict[str, Any]:
    print("STAGE 1/3 - DEV1 DATA PIPELINE")
    raw_df = load_csv(file_path)
    target_col = _resolve_target_column(raw_df, target_col)
    clean_df, dev1_report = run_dev1_data_pipeline(raw_df, target_col)
    X, y = split_features_target(clean_df, target_col)
    # Some sklearn imputers can fail on read-only views from pandas internals.
    X = X.copy(deep=True)
    y = y.copy(deep=True)
    print(f"Rows after cleaning: {dev1_report['rows_after_cleaning']}")

    print("\nSTAGE 2/3 - DEV2 AUTO ML DOCTOR")
    problem_type = detect_problem_type(y)
    num_cols, cat_cols = infer_column_types(X)
    # Use IterativeImputer only on smaller datasets to avoid heavy runtime.
    preprocessor = build_preprocessor(num_cols, cat_cols, use_iterative=(X.shape[0] < 2000))
    selector = get_feature_selector(problem_type, X)
    cv_scores = train_models_core(X, y, preprocessor, selector, problem_type)

    ranked, top_model_names = _select_best_dev2_model(cv_scores, problem_type)
    available_models = smart_model_selector(X, y, problem_type)
    selected_models = {
        name: available_models[name] for name in top_model_names if name in available_models
    }

    if not selected_models:
        raise RuntimeError("No compatible model selected from Dev2 shortlist.")

    use_ensemble = False
    min_class_count = int(y.value_counts().min()) if problem_type == "classification" else None
    if (
        len(ranked) > 1
        and abs(ranked[0][1] - ranked[1][1]) < 0.02
        and (problem_type != "classification" or (min_class_count is not None and min_class_count >= 2))
    ):
        use_ensemble = True

    if use_ensemble and len(selected_models) > 1:
        dev2_model = build_ensemble(selected_models, problem_type)
        dev2_choice = {"type": "ensemble", "members": list(selected_models.keys())}
    else:
        model_name = next(iter(selected_models))
        dev2_model = selected_models[model_name]
        dev2_choice = {"type": "single", "members": [model_name]}

    trained_model, X_train, X_test, y_train, y_test = final_training(
        X, y, preprocessor, selector, dev2_model, problem_type
    )
    baseline_metrics = evaluate(trained_model, X_train, X_test, y_train, y_test, problem_type)
    print(f"Problem type: {problem_type}")
    print(f"Dev2 model choice: {dev2_choice}")

    print("\nSTAGE 3/3 - DEV3 AUTO OPTIMIZATION")
    optimization = optimize_model(
        trained_model,
        X_train,
        X_test,
        y_train,
        y_test,
        problem_type,
        random_state=random_state,
    )
    final_model = optimization["final_model"]
    final_metrics = evaluate(final_model, X_train, X_test, y_train, y_test, problem_type)
    print(f"Issue detected by Dev3: {optimization['issue_detected']}")
    print(f"Selected version: {optimization['selected_model_version']}")
    _plot_final_model_visuals(
        baseline_model_name=_extract_model_name(trained_model),
        final_model=final_model,
        problem_type=problem_type,
        baseline_metrics=baseline_metrics,
        final_metrics=final_metrics,
        X_train=X_train,
        X_test=X_test,
        y_train=y_train,
        y_test=y_test,
    )

    return {
        "data_report": dev1_report,
        "problem_type": problem_type,
        "dev2": {
            "ranked_models": ranked,
            "choice": dev2_choice,
            "baseline_metrics": _sanitize_dict(baseline_metrics),
        },
        "dev3": {
            "metric": optimization["metric"],
            "issue_detected": optimization["issue_detected"],
            "imbalance_detected": _convert_numpy(optimization["imbalance_detected"]),
            "selected_model_version": optimization["selected_model_version"],
            "best_candidate_name": optimization["best_candidate_name"],
            "before_train": _convert_numpy(optimization["before_train"]),
            "before_test": _convert_numpy(optimization["before_test"]),
            "after_train": _convert_numpy(optimization["after_train"]),
            "after_test": _convert_numpy(optimization["after_test"]),
            "final_train": _convert_numpy(optimization["final_train"]),
            "final_test": _convert_numpy(optimization["final_test"]),
            "candidate_scores": _sanitize_dict(
                {
                    name: {
                        "train": _convert_numpy(score["train"]),
                        "test": _convert_numpy(score["test"]),
                    }
                    for name, score in optimization["candidate_scores"].items()
                }
            ),
            "failed_candidates": optimization["failed_candidates"],
            "final_metrics": _sanitize_dict(final_metrics),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Integrated Dev1 -> Dev2 -> Dev3 AutoML pipeline runner."
    )
    parser.add_argument("--file-path", required=True, help="Path to input CSV file.")
    parser.add_argument("--target-col", required=True, help="Target column name in CSV.")
    parser.add_argument(
        "--output-json",
        default="pipeline_report.json",
        help="Where to save the final pipeline report JSON.",
    )
    parser.add_argument(
        "--random-state", type=int, default=42, help="Random seed for reproducibility."
    )
    parser.add_argument(
        "--visualizations",
        choices=["yes", "no", "ask"],
        default="ask",
        help="Run Dev0 visualizations before AutoML: yes/no/ask.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_visualizations = False
    if args.visualizations == "yes":
        run_visualizations = True
    elif args.visualizations == "no":
        run_visualizations = False
    else:
        choice = input("Do you want to run visualizations first? (yes/no): ").strip().lower()
        run_visualizations = choice in {"yes", "y"}

    if run_visualizations:
        raw_df = load_csv(args.file_path)
        resolved_target = _resolve_target_column(raw_df, args.target_col)
        run_eda(args.file_path, resolved_target)

    report = run_full_pipeline(
        file_path=args.file_path,
        target_col=args.target_col,
        random_state=args.random_state,
    )

    output_path = Path(args.output_json)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\nPIPELINE COMPLETED")
    print(f"Report saved to: {output_path.resolve()}")
    print(f"Final metrics: {report['dev3']['final_metrics']}")


if __name__ == "__main__":
    main()
