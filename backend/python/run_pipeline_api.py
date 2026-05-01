import argparse
import json
import os
import pickle
from pathlib import Path

import pandas as pd


def _emit_progress(stage: str, pct: int, message: str):
    payload = {
        "currentStage": stage,
        "progressPct": pct,
        "stageMessage": message,
    }
    print(f"PROGRESS: {json.dumps(payload)}", flush=True)


def _install_plot_capture(plot_dir: Path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plot_dir.mkdir(parents=True, exist_ok=True)
    counter = {"value": 0}

    def _capture_show(*_args, **_kwargs):
        fig_nums = plt.get_fignums()
        for fig_num in fig_nums:
            fig = plt.figure(fig_num)
            counter["value"] += 1
            out_path = plot_dir / f"plot_{counter['value']:04d}.png"
            fig.savefig(out_path, dpi=140, bbox_inches="tight")
            plt.close(fig)

    plt.show = _capture_show
    return plt


def _plot_training_testing_accuracy(final_metrics):
    train_acc = final_metrics.get("train_acc")
    test_acc = final_metrics.get("test_acc")
    if train_acc is None or test_acc is None:
        return

    import matplotlib.pyplot as plt

    plt.figure(figsize=(6, 4))
    bars = plt.bar(["Training Accuracy", "Testing Accuracy"], [train_acc, test_acc], color=["#60a5fa", "#2563eb"])
    plt.ylim(0, 1.05)
    plt.title("Training vs Testing Accuracy")
    plt.ylabel("Accuracy")
    for bar, value in zip(bars, [train_acc, test_acc]):
        plt.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.01,
            f"{value:.3f}",
            ha="center",
            va="bottom",
            fontsize=9,
        )
    plt.tight_layout()
    plt.show()


def train_and_collect(project_root, dataset_path, target_col, visualizations="no", random_state=42):
    import sys

    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    from dev0 import run_eda
    from dev1_data_pipeline import (
        _extract_model_name,
        _plot_final_model_visuals,
        _resolve_target_column,
        run_dev1_data_pipeline,
    )
    from dev2_automl_doctor import (
        build_ensemble,
        build_preprocessor,
        detect_problem_type,
        evaluate,
        final_training,
        get_feature_selector,
        infer_column_types,
        smart_model_selector,
        split_features_target,
        train_models_core,
    )
    from dev3_auto_optimization import optimize_model

    _emit_progress("analyzing", 10, "Analyzing your dataset...")
    raw_df = pd.read_csv(dataset_path)
    raw_df.columns = [c.strip() for c in raw_df.columns]
    target_col = _resolve_target_column(raw_df, target_col)

    _emit_progress("preprocessing", 30, "Preprocessing and cleaning data...")
    clean_df, data_report = run_dev1_data_pipeline(raw_df, target_col)
    X, y = split_features_target(clean_df, target_col)
    X = X.copy(deep=True)
    y = y.copy(deep=True)

    problem_type = detect_problem_type(y)
    num_cols, cat_cols = infer_column_types(X)
    preprocessor = build_preprocessor(num_cols, cat_cols, use_iterative=(X.shape[0] < 2000))
    selector = get_feature_selector(problem_type, X)
    _emit_progress("training", 55, "Training model candidates...")
    cv_scores = train_models_core(X, y, preprocessor, selector, problem_type)

    if problem_type == "classification":
        ranked = sorted(
            ((name, metric["f1_weighted"]) for name, metric in cv_scores.items()),
            key=lambda item: item[1],
            reverse=True,
        )
    else:
        ranked = sorted(
            ((name, metric["r2"]) for name, metric in cv_scores.items()),
            key=lambda item: item[1],
            reverse=True,
        )

    top_model_names = [name for name, _ in ranked[:4]]
    available_models = smart_model_selector(X, y, problem_type)
    selected_models = {name: available_models[name] for name in top_model_names if name in available_models}
    if not selected_models:
        raise RuntimeError("No compatible model selected from Dev2 shortlist.")

    use_ensemble = False
    if len(ranked) > 1 and abs(ranked[0][1] - ranked[1][1]) < 0.02:
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

    _emit_progress("evaluating", 80, "Evaluating and optimizing models...")
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

    if visualizations == "yes":
        run_eda(dataset_path, target_col)
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
    if problem_type == "classification":
        _plot_training_testing_accuracy(final_metrics)

    _emit_progress("finalize", 95, "Finalizing artifacts...")
    report = {
        "data_report": data_report,
        "problem_type": problem_type,
        "dev2": {
            "ranked_models": ranked,
            "choice": dev2_choice,
            "baseline_metrics": baseline_metrics,
        },
        "dev3": {
            "metric": optimization["metric"],
            "issue_detected": optimization["issue_detected"],
            "imbalance_detected": optimization["imbalance_detected"],
            "selected_model_version": optimization["selected_model_version"],
            "best_candidate_name": optimization["best_candidate_name"],
            "before_train": optimization["before_train"],
            "before_test": optimization["before_test"],
            "after_train": optimization["after_train"],
            "after_test": optimization["after_test"],
            "final_train": optimization["final_train"],
            "final_test": optimization["final_test"],
            "candidate_scores": optimization["candidate_scores"],
            "failed_candidates": optimization["failed_candidates"],
            "final_metrics": final_metrics,
        },
    }

    return {
        "report": report,
        "final_model": final_model,
        "feature_columns": list(X.columns),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--dataset-path", required=True)
    parser.add_argument("--target-col", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--visualizations", default="no")
    args = parser.parse_args()

    project_root = Path(args.project_root)
    generated_dir = project_root / "backend" / "generated"
    generated_dir.mkdir(parents=True, exist_ok=True)
    plot_dir = generated_dir / f"{args.run_id}-plots"
    _install_plot_capture(plot_dir)

    trained = train_and_collect(
        project_root=str(project_root),
        dataset_path=args.dataset_path,
        target_col=args.target_col,
        visualizations=args.visualizations,
    )

    report_path = generated_dir / f"{args.run_id}-report.json"
    model_path = generated_dir / f"{args.run_id}-model.pkl"
    python_script_path = generated_dir / f"{args.run_id}-train.py"

    with report_path.open("w", encoding="utf-8") as f:
        json.dump(trained["report"], f, indent=2, default=str)
    with model_path.open("wb") as f:
        pickle.dump(trained["final_model"], f)
    with python_script_path.open("w", encoding="utf-8") as f:
        f.write(
            "from dev1_data_pipeline import run_full_pipeline\n\n"
            "if __name__ == '__main__':\n"
            f"    report = run_full_pipeline(file_path=r'{args.dataset_path}', target_col='{args.target_col}')\n"
            "    print(report['dev3']['final_metrics'])\n"
        )

    output = {
        "report": trained["report"],
        "report_path": str(report_path),
        "model_path": str(model_path),
        "python_script_path": str(python_script_path),
        "feature_columns": trained["feature_columns"],
        "plot_paths": [str(p) for p in sorted(plot_dir.glob("*.png"))],
    }
    _emit_progress("finalize", 100, "Pipeline completed successfully.")
    print(json.dumps(output, default=str))


if __name__ == "__main__":
    main()
