"""
Dataset size / shape heuristics for AutoML: rows × columns → runtime, memory, CV, models, EDA.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict


@dataclass(frozen=True)
class ScalingStrategy:
    # --- Row bucket (primary) ---
    tier: str  # XS | S | M | L

    # --- Preprocessing ---
    use_iterative_imputer: bool
    downcast_float: bool
    one_hot_sparse: bool

    # --- Cross-validation & sampling ---
    cv_n_splits: int
    cv_sample_cap: int
    feature_selection_k: int

    # --- Models & parallel ---
    allow_knn_svm: bool
    use_only_scalable_estimators: bool
    use_xgb_lgbm: bool
    n_jobs: int

    # --- Feature engineering (ML pipeline, post-preprocessor in current stack) ---
    use_polynomial_features: bool
    use_pca_or_dr: bool
    use_incremental_pca: bool
    use_truncated_svd: bool  # used when extremely wide after transforms
    skip_polynomial_entirely: bool

    # --- Column-shape rules ---
    apply_wide_table_filters: bool
    use_frequency_encoding: bool
    variance_drop_ratio: float
    corr_drop_threshold: float
    max_total_features_after_compress: int | None

    # --- Dev3 tuning ---
    use_randomized_search: bool
    randomized_search_iter: int
    randomized_search_cv: int

    # --- EDA ---
    eda_plot_max_rows: int
    eda_full_univariate: bool
    eda_include_pairplot: bool
    eda_include_kde_violin: bool
    eda_heatmap_annotate: bool  # False for huge correlation matrices
    eda_top_features_only: bool
    read_chunk_size: int | None  # hint for ingests

    # --- Targets / reporting ---
    target_runtime_minutes: float
    use_chunk_training: bool

    # --- Latency (cross-run training time) ---
    cv_max_models: int
    dev3_fast: bool

    def to_report_dict(self) -> Dict[str, Any]:
        return dict(asdict(self))


def infer_scaling_strategy(
    n_rows: int,
    n_numeric_cols: int,
    n_categorical_cols: int,
) -> ScalingStrategy:
    n_total = int(n_numeric_cols + n_categorical_cols)

    # ---- Base tier by rows (user spec) ----
    # Default new fields (overridden per tier)
    cv_max_models = 4
    dev3_fast = False

    if n_rows < 10_000:
        row_tier = "XS"
        use_iter = True
        downcast = False
        cv_splits = 5
        cv_cap = min(4_500, max(n_rows, 400))
        allow_slow = True
        scalable_only = False
        use_poly = True
        use_pca_dr = n_numeric_cols > 50 or n_total > 40
        incr_pca = False
        trunc_svd = False
        skip_poly = False
        fs_k = min(25, max(10, n_total))
        one_hot_sparse = n_total > 200
        wide_filter = n_total > 100
        freq_enc = n_categorical_cols > 30
        rand_search = False
        rs_iter = 0
        rs_cv = 3
        eda_rows = min(n_rows, 10_000)
        eda_full_uni = True
        eda_pair = True
        eda_kv = True
        heat_anno = n_numeric_cols <= 25
        eda_top_only = False
        chunk_sz = None
        runtime_target = 2.0
        chunk_train = False
        max_feat_cap: int | None = 400 if n_total > 500 else (250 if n_total > 200 else None)
    elif n_rows < 50_000:
        row_tier = "S"
        cv_max_models = 2
        dev3_fast = True
        use_iter = False
        downcast = n_rows >= 25_000
        cv_splits = 3
        cv_cap = 2_800
        allow_slow = False
        scalable_only = False
        use_poly = n_rows <= 35_000 and n_total < 120
        use_pca_dr = n_numeric_cols > 50 or n_total > 80
        incr_pca = False
        trunc_svd = n_total > 500
        skip_poly = n_total > 150 or n_rows > 40_000
        fs_k = min(20, max(8, min(n_total, 30)))
        one_hot_sparse = True
        wide_filter = n_total > 80
        freq_enc = n_categorical_cols > 30
        rand_search = False
        rs_iter = 0
        rs_cv = 2
        eda_rows = 3000
        eda_full_uni = False
        eda_pair = False
        eda_kv = False
        heat_anno = n_numeric_cols <= 20
        eda_top_only = False
        chunk_sz = None
        runtime_target = 2.0
        chunk_train = False
        max_feat_cap = 350 if n_total > 500 else (220 if n_total > 120 else None)
    elif n_rows <= 100_000:
        row_tier = "M"
        cv_max_models = 2
        dev3_fast = True
        use_iter = False
        downcast = True
        cv_splits = 2
        cv_cap = 2_000
        allow_slow = False
        scalable_only = True
        use_poly = False
        use_pca_dr = True
        incr_pca = True
        trunc_svd = n_total > 400
        skip_poly = True
        fs_k = min(40, max(10, min(n_total, 50)))
        one_hot_sparse = True
        wide_filter = True
        freq_enc = n_categorical_cols > 20
        rand_search = False
        rs_iter = 0
        rs_cv = 2
        eda_rows = 2_500
        eda_full_uni = False
        eda_pair = False
        eda_kv = False
        heat_anno = False
        eda_top_only = False
        chunk_sz = 15_000
        runtime_target = 2.0
        chunk_train = n_rows >= 80_000
        max_feat_cap = 300 if n_total > 400 else 200
    else:
        row_tier = "L"
        cv_max_models = 2
        dev3_fast = True
        use_iter = False
        downcast = True
        cv_splits = 2
        cv_cap = 1_500
        allow_slow = False
        scalable_only = True
        use_poly = False
        use_pca_dr = True
        incr_pca = True
        trunc_svd = True
        skip_poly = True
        fs_k = min(35, max(8, min(n_total, 40)))
        one_hot_sparse = True
        wide_filter = True
        freq_enc = n_categorical_cols > 15
        rand_search = False
        rs_iter = 0
        rs_cv = 2
        eda_rows = 2_000
        eda_full_uni = False
        eda_pair = False
        eda_kv = False
        heat_anno = False
        eda_top_only = True
        chunk_sz = 15_000
        runtime_target = 1.75
        # Chunk-wise retraining multiplies wall time (one full fit per chunk); keep off for L by default.
        chunk_train = False
        max_feat_cap = 250

    # ---- Column overlays (tighten for huge width) ----
    if n_total > 500:
        skip_poly = True
        trunc_svd = True
        use_pca_dr = True
        incr_pca = True
        freq_enc = freq_enc or n_categorical_cols > 15
        wide_filter = True
        one_hot_sparse = True
        if max_feat_cap is None or max_feat_cap > 200:
            max_feat_cap = 200
        fs_k = min(fs_k, 30)

    if n_total > 100:
        wide_filter = True

    fs_k = max(5, min(fs_k, max(5, n_total)))

    return ScalingStrategy(
        tier=row_tier,
        use_iterative_imputer=use_iter,
        downcast_float=downcast,
        one_hot_sparse=one_hot_sparse,
        cv_n_splits=cv_splits,
        cv_sample_cap=cv_cap,
        feature_selection_k=fs_k,
        allow_knn_svm=allow_slow,
        use_only_scalable_estimators=scalable_only,
        use_xgb_lgbm=scalable_only or n_rows >= 40_000,
        n_jobs=-1,
        use_polynomial_features=use_poly and not skip_poly,
        use_pca_or_dr=use_pca_dr,
        use_incremental_pca=incr_pca,
        use_truncated_svd=trunc_svd,
        skip_polynomial_entirely=skip_poly,
        apply_wide_table_filters=wide_filter,
        use_frequency_encoding=freq_enc,
        variance_drop_ratio=1e-8,
        corr_drop_threshold=0.985,
        max_total_features_after_compress=max_feat_cap,
        use_randomized_search=rand_search,
        randomized_search_iter=rs_iter,
        randomized_search_cv=rs_cv,
        eda_plot_max_rows=eda_rows,
        eda_full_univariate=eda_full_uni,
        eda_include_pairplot=eda_pair,
        eda_include_kde_violin=eda_kv,
        eda_heatmap_annotate=heat_anno,
        eda_top_features_only=eda_top_only,
        read_chunk_size=chunk_sz,
        target_runtime_minutes=runtime_target,
        use_chunk_training=chunk_train,
        cv_max_models=cv_max_models,
        dev3_fast=dev3_fast,
    )
