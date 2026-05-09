import argparse
import json
import os
import pickle
import math
from pathlib import Path
from typing import Any, Dict

import numpy as np
import pandas as pd

LARGE_DATASET_ROW_THRESHOLD = 100000
LARGE_DATASET_CHUNK_ROWS = 15000

# .../automl — holds dev0.py, scalable_preprocessing.py, dev2_automl_doctor.py, etc.
# (this file is at automl/backend/python/run_pipeline_api.py)
_AUTOML_SRC_ROOT = str(Path(__file__).resolve().parents[2])


def _ensure_automl_sys_path(project_root: str) -> None:
    """
    Put bundled automl modules first on sys.path.
    --project-root may contain an older dev2_automl_doctor.py; that must not shadow this repo.
    """
    import sys

    def _resolved(path_str: str):
        try:
            return Path(path_str).resolve()
        except OSError:
            return None

    def _drop_match(resolved_target):
        if resolved_target is None:
            return

        def keep(p: str) -> bool:
            if not p:
                return True
            try:
                return Path(p).resolve() != resolved_target
            except OSError:
                return True

        sys.path[:] = [p for p in sys.path if keep(p)]

    am = _resolved(_AUTOML_SRC_ROOT)
    _drop_match(am)
    sys.path.insert(0, _AUTOML_SRC_ROOT)

    if not project_root:
        return
    pr = _resolved(project_root)
    if pr == am:
        return
    _drop_match(pr)
    sys.path.append(project_root)


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


def _read_dataset_batchwise(dataset_path: str):
    chunks = []
    total_rows = 0
    for chunk in pd.read_csv(dataset_path, chunksize=LARGE_DATASET_CHUNK_ROWS):
        chunks.append(chunk)
        total_rows += len(chunk)
        if total_rows == LARGE_DATASET_CHUNK_ROWS:
            _emit_progress("analyzing", 12, "Reading large dataset in batches...")
        elif total_rows > LARGE_DATASET_CHUNK_ROWS:
            _emit_progress(
                "analyzing",
                12,
                f"Reading next batch... rows ingested so far: {total_rows}",
            )
    if not chunks:
        return pd.DataFrame()
    return pd.concat(chunks, ignore_index=True)


def _load_dataset(dataset_path: str):
    # Read in a single pass to avoid double disk I/O on large datasets.
    chunks = []
    total_rows = 0
    is_large = False

    for chunk in pd.read_csv(dataset_path, chunksize=LARGE_DATASET_CHUNK_ROWS):
        chunks.append(chunk)
        total_rows += len(chunk)

        if not is_large and total_rows > 20000:
            is_large = True
            _emit_progress(
                "analyzing",
                11,
                (
                    f"Large ingest mode ({total_rows}+ rows): "
                    f"reading CSV in {LARGE_DATASET_CHUNK_ROWS}-row chunks..."
                ),
            )
        elif is_large:
            _emit_progress(
                "analyzing",
                12,
                f"Reading next batch... rows ingested so far: {total_rows}",
            )

    if not chunks:
        return pd.DataFrame()
    return pd.concat(chunks, ignore_index=True)


def train_and_collect(project_root, dataset_path, target_col, visualizations="no", random_state=42):
    _ensure_automl_sys_path(project_root)

    from dev0 import run_eda
    from dev1_data_pipeline import (
        _extract_model_name,
        _plot_final_model_visuals,
        _resolve_target_column,
        run_dev1_data_pipeline,
    )
    from scalable_preprocessing import prepare_frame_memory
    from scalable_strategy import infer_scaling_strategy
    from scalable_table import apply_frequency_encoding, compress_wide_features
    from dev2_automl_doctor import (
        LEAKAGE_GUARD_NOTE,
        build_ensemble,
        build_smart_preprocessor,
        detect_problem_type,
        evaluate,
        final_training,
        get_feature_selector,
        infer_column_types,
        sanitize_leakage_features,
        smart_model_selector,
        split_features_target,
        train_models_core,
    )
    from dev3_auto_optimization import optimize_model
    from chunk_ensemble_model import ChunkEnsembleModel
    from sklearn.base import clone

    _emit_progress("analyzing", 10, "Analyzing your dataset...")
    raw_df = _load_dataset(dataset_path)
    raw_df.columns = [c.strip() for c in raw_df.columns]
    target_col = _resolve_target_column(raw_df, target_col)

    _emit_progress("preprocessing", 30, "Preprocessing and cleaning data...")
    clean_df, data_report = run_dev1_data_pipeline(raw_df, target_col)
    X, y = split_features_target(clean_df, target_col)
    X = X.copy(deep=True)
    y = y.copy(deep=True)

    X, leakage_dropped = sanitize_leakage_features(X, y)
    data_report = {
        **data_report,
        "leakage_guard": {
            "dropped_columns": leakage_dropped,
            "note": LEAKAGE_GUARD_NOTE,
        },
    }

    problem_type = detect_problem_type(y)
    num_cols, cat_cols = infer_column_types(X)
    scaling_strategy = infer_scaling_strategy(len(X), len(num_cols), len(cat_cols))

    shape_notes: Dict[str, Any] = {}
    if getattr(scaling_strategy, "use_frequency_encoding", False) and cat_cols:
        X, num_cols, cat_cols, enc_names = apply_frequency_encoding(X, cat_cols)
        shape_notes["frequency_encoded_columns"] = enc_names

    X, num_cols, cat_cols, wide_report = compress_wide_features(X, y, num_cols, cat_cols, scaling_strategy)
    shape_notes["wide_compression"] = wide_report

    data_report = {**data_report, "shape_transforms": shape_notes}

    X = prepare_frame_memory(X, scaling_strategy)

    preprocessor = build_smart_preprocessor(num_cols, cat_cols, problem_type, scaling_strategy)
    selector = get_feature_selector(problem_type, X, scaling_strategy)
    _emit_progress(
        "training",
        55,
        f"Training candidates (tier={scaling_strategy.tier}, rows={len(X)}, features={len(num_cols)+len(cat_cols)})...",
    )
    cv_scores = train_models_core(X, y, preprocessor, selector, problem_type, scaling_strategy)

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
    available_models = smart_model_selector(X, y, problem_type, scaling_strategy)
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
        X, y, preprocessor, selector, dev2_model, problem_type, scaling_strategy
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
        scaling_strategy=scaling_strategy,
    )
    final_model = optimization["final_model"]
    final_metrics = evaluate(final_model, X_train, X_test, y_train, y_test, problem_type)

    # For very large datasets, optionally train extra chunk models and merge (strategy-gated; off by default on tier L).
    chunk_ensemble_enabled = X.shape[0] > LARGE_DATASET_ROW_THRESHOLD and getattr(
        scaling_strategy, "use_chunk_training", False
    )
    if chunk_ensemble_enabled:
        _emit_progress("training", 70, "Building chunk-wise ensemble models...")
        rng = np.random.default_rng(random_state)
        shuffled_idx = rng.permutation(X.index.to_numpy())
        chunk_models = [final_model]
        total_chunks = int(math.ceil(len(shuffled_idx) / LARGE_DATASET_CHUNK_ROWS))

        for i in range(total_chunks):
            start = i * LARGE_DATASET_CHUNK_ROWS
            end = min(start + LARGE_DATASET_CHUNK_ROWS, len(shuffled_idx))
            chunk_idx = shuffled_idx[start:end]
            if len(chunk_idx) < 2:
                continue

            X_chunk = X.loc[chunk_idx].copy(deep=True)
            y_chunk = y.loc[chunk_idx].copy(deep=True)
            chunk_preprocessor = build_smart_preprocessor(
                num_cols, cat_cols, problem_type, scaling_strategy
            )
            chunk_selector = get_feature_selector(problem_type, X_chunk, scaling_strategy)
            chunk_model_base = (
                build_ensemble(
                    {name: clone(model) for name, model in selected_models.items()},
                    problem_type,
                )
                if use_ensemble and len(selected_models) > 1
                else clone(selected_models[next(iter(selected_models))])
            )
            try:
                chunk_trained_model, *_ = final_training(
                    X_chunk,
                    y_chunk,
                    chunk_preprocessor,
                    chunk_selector,
                    chunk_model_base,
                    problem_type,
                    scaling_strategy,
                )
                chunk_models.append(chunk_trained_model)
            except Exception:
                continue
            _emit_progress(
                "training",
                70 + int(((i + 1) / max(total_chunks, 1)) * 10),
                f"Chunk model {i + 1}/{total_chunks} trained.",
            )

        if len(chunk_models) > 1:
            final_model = ChunkEnsembleModel(models=chunk_models, problem_type=problem_type)
            final_metrics = evaluate(final_model, X_train, X_test, y_train, y_test, problem_type)

    if visualizations == "yes":
        run_eda(dataset_path, target_col, scaling_strategy=scaling_strategy)
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
        "scaling_strategy": scaling_strategy.to_report_dict(),
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
            "chunk_ensemble": {
                "enabled": chunk_ensemble_enabled,
                "threshold_rows": LARGE_DATASET_ROW_THRESHOLD,
                "chunk_rows": LARGE_DATASET_CHUNK_ROWS,
            },
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
    parser.add_argument("--generated-dir", required=False, default=None)
    parser.add_argument("--dataset-path", required=True)
    parser.add_argument("--target-col", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--visualizations", default="no")
    args = parser.parse_args()

    project_root = Path(args.project_root)
    generated_dir = (
        Path(args.generated_dir)
        if args.generated_dir
        else (Path.cwd() / "generated")
    )
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
