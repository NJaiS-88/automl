from __future__ import annotations

import os
from typing import Any, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin

from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer

from sklearn.preprocessing import FunctionTransformer, StandardScaler, OneHotEncoder
from sklearn.impute import SimpleImputer
from sklearn.feature_selection import SelectKBest, f_classif, f_regression

from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.ensemble import (
    RandomForestClassifier,
    RandomForestRegressor,
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    StackingClassifier,
    StackingRegressor,
)
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.naive_bayes import GaussianNB

from sklearn.metrics import (
    accuracy_score,
    f1_score,
    r2_score,
    precision_score,
    recall_score,
    roc_auc_score,
    mean_absolute_error,
    mean_squared_error,
    normalized_mutual_info_score,
)

from sklearn.experimental import enable_iterative_imputer  # noqa: F401
from sklearn.impute import IterativeImputer
from sklearn.preprocessing import PolynomialFeatures
from sklearn.decomposition import PCA, IncrementalPCA, TruncatedSVD
from sklearn.model_selection import StratifiedKFold, KFold

from imblearn.over_sampling import SMOTE
from imblearn.under_sampling import RandomUnderSampler
from imblearn.pipeline import Pipeline as ImbPipeline

# Imbalanced classification: below this row count (before split) use SMOTE; at or above, random undersampling.
IMBALANCE_OVERSAMPLE_MAX_ROWS = 10_000
# Minority class share below this (with majority:minority ratio rule) => treat as imbalanced. Keep in sync with dev3 check_imbalance.
IMBALANCE_MINOR_RATIO_THRESHOLD = 0.3

# Feature–target NMI above this ⇒ treat as leakage (e.g. outcome/status columns). Override: AUTOML_LEAKAGE_NMI_MAX=0.93
_LEAKAGE_NMI_DEFAULT = 0.90
# Numeric Pearson correlation magnitude above this ⇒ leakage.
_LEAKAGE_CORR_DEFAULT = 0.995

LEAKAGE_GUARD_NOTE = (
    "Removed ID-like columns, exact/near-duplicate of target, very high correlation with target, "
    "or very high normalized MI with target (typical of post-outcome fields like booking status)."
)


def _leakage_nmi_cutoff() -> float:
    return float(os.getenv("AUTOML_LEAKAGE_NMI_MAX", str(_LEAKAGE_NMI_DEFAULT)))


def _leakage_corr_cutoff() -> float:
    return float(os.getenv("AUTOML_LEAKAGE_CORR_ABS", str(_LEAKAGE_CORR_DEFAULT)))


def _factor_labels(series: pd.Series) -> np.ndarray:
    codes, _ = pd.factorize(series.fillna("__NA__"), sort=False)
    return codes.astype(np.int64)


def _encoded_for_leakage_nmi(col: pd.Series) -> np.ndarray:
    """Discretize for NMI: coarse bins for high-cardinality numerics; categorical otherwise."""
    s = col.reset_index(drop=True)
    if pd.api.types.is_numeric_dtype(s):
        nuniq = s.nunique(dropna=True)
        if nuniq > 50:
            try:
                q = min(50, max(5, len(s) // 50))
                binned = pd.qcut(s, q=q, duplicates="drop")
                return _factor_labels(binned.astype(str))
            except Exception:
                pass
            return _factor_labels(s.round(8).astype(str))
    return _factor_labels(s.astype(str))


def _encoded_target_for_leakage_nmi(y: pd.Series) -> np.ndarray:
    y = y.reset_index(drop=True)
    if pd.api.types.is_numeric_dtype(y) and y.nunique(dropna=True) > 30:
        try:
            q = min(20, max(3, y.nunique(dropna=True) // 5))
            yb = pd.qcut(y, q=q, duplicates="drop")
            return _factor_labels(yb.astype(str))
        except Exception:
            pass
    return _factor_labels(y.astype(str))


def _nmi_feature_target(col: pd.Series, y: pd.Series) -> float:
    """High values ⇒ feature almost determines target (leak), including categorical proxies."""
    pair = pd.concat([col, y], axis=1).dropna()
    if len(pair) < 25:
        return 0.0
    xc = _encoded_for_leakage_nmi(pair.iloc[:, 0])
    yc = _encoded_target_for_leakage_nmi(pair.iloc[:, 1])
    if len(np.unique(xc)) <= 1 or len(np.unique(yc)) <= 1:
        return 0.0
    return float(normalized_mutual_info_score(xc, yc))


def _memory_safe_mode():
    flag = os.getenv("AUTOML_MEMORY_SAFE", "").strip().lower()
    return flag in {"1", "true", "yes", "on"} or bool(os.getenv("RENDER"))


def _parallel_jobs(scaling_strategy=None):
    if _memory_safe_mode():
        return 1
    if scaling_strategy is not None:
        nj = getattr(scaling_strategy, "n_jobs", None)
        if nj is not None:
            return nj
    return -1


def load_csv(file):
    df = pd.read_csv(file)
    df.columns = [c.strip() for c in df.columns]
    return df


def split_features_target(df, target_col):
    X = df.drop(columns=[target_col])
    y = df[target_col]
    return X, y


def infer_column_types(X):
    num_cols = list(X.select_dtypes(include=["int64", "float64"]).columns)
    cat_cols = [c for c in X.columns if c not in num_cols]
    return num_cols, cat_cols


def detect_problem_type(y):
    unique_count = y.nunique(dropna=True)
    unique_ratio = unique_count / max(len(y), 1)

    # Numeric targets with many distinct values are usually regression,
    # even if unique ratio is modest on larger datasets.
    if pd.api.types.is_numeric_dtype(y):
        if unique_count > 30 and unique_ratio > 0.005:
            return "regression"
        if unique_count > max(20, int(0.05 * len(y))):
            return "regression"

    if unique_count <= max(20, int(0.05 * len(y))):
        return "classification"
    return "regression"


def _classification_min_count(y):
    counts = y.value_counts()
    if counts.empty:
        return 0
    return int(counts.min())


def _is_classification_imbalanced(y: pd.Series) -> bool:
    """Aligned with dev3 check_imbalance: minority share or majority:minority ratio."""
    if y.nunique(dropna=True) <= 1:
        return False
    ratio = y.value_counts(normalize=True)
    minority_ratio = float(ratio.min())
    majority_to_minority = float(ratio.max() / max(minority_ratio, 1e-9))
    return minority_ratio < IMBALANCE_MINOR_RATIO_THRESHOLD or majority_to_minority > 4.0


def _smote_k_neighbors(y: pd.Series) -> Optional[int]:
    m = _classification_min_count(y)
    if m < 2:
        return None
    return max(1, min(5, m - 1))


def _imbalance_sampler_step(
    problem_type: str,
    y_ref: pd.Series,
    n_rows_for_size_choice: int,
) -> Optional[Tuple[str, Any]]:
    """
    Resampling runs after the column transformer (numeric encoded features).
    SMOTE when the overall dataset is small; random undersampling when large.
    """
    if problem_type != "classification" or not _is_classification_imbalanced(y_ref):
        return None
    large = n_rows_for_size_choice >= IMBALANCE_OVERSAMPLE_MAX_ROWS
    if large:
        return ("undersample", RandomUnderSampler(random_state=42, sampling_strategy="auto"))
    kn = _smote_k_neighbors(y_ref)
    if kn is None:
        return None
    return ("smote", SMOTE(random_state=42, k_neighbors=kn))


def _assemble_model_pipeline(
    preprocessor,
    selector,
    feature_engineering,
    model,
    sampler_step: Optional[Tuple[str, Any]],
):
    steps: list[tuple[str, Any]] = [
        ("pre", preprocessor),
        ("feat", selector),
        ("eng", feature_engineering),
        ("model", model),
    ]
    if sampler_step is not None:
        name, sampler = sampler_step
        steps.insert(1, (name, sampler))
        return ImbPipeline(steps)
    return Pipeline(steps)


def _safe_cv(problem_type, y, preferred_splits=3, scaling_strategy=None):
    if scaling_strategy is not None:
        preferred_splits = int(getattr(scaling_strategy, "cv_n_splits", preferred_splits) or preferred_splits)
    if problem_type != "classification":
        n_splits = min(preferred_splits, len(y))
        n_splits = max(2, n_splits)
        return KFold(n_splits=n_splits, shuffle=True, random_state=42)

    min_count = _classification_min_count(y)
    if min_count >= 2:
        n_splits = min(preferred_splits, min_count, len(y))
        n_splits = max(2, n_splits)
        return StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)

    n_splits = min(preferred_splits, len(y))
    n_splits = max(2, n_splits)
    return KFold(n_splits=n_splits, shuffle=True, random_state=42)


def _ensure_writeable_array(x):
    return np.array(x, copy=True)


def build_smart_preprocessor(num_cols, cat_cols, problem_type, scaling_strategy):
    """
    Wrapper for run_pipeline_api: preprocessor choice follows ScalingStrategy tier.
    """
    _ = problem_type
    use_iter = bool(getattr(scaling_strategy, "use_iterative_imputer", False))
    sparse_ohe = bool(getattr(scaling_strategy, "one_hot_sparse", False))
    return build_preprocessor(num_cols, cat_cols, use_iterative=use_iter, sparse_ohe=sparse_ohe)


def sanitize_leakage_features(X: pd.DataFrame, y: pd.Series):
    """
    Drop label leakage and trivial proxies: IDs, duplicate/near-duplicate of target, extreme numeric
    correlation, and very high feature–target NMI (captures categorical outcome fields such as
    reservation status when predicting cancellation).
    """
    dropped: list[str] = []
    Xo = X.copy()
    y_aligned = y.reindex(Xo.index)
    nmi_cut = _leakage_nmi_cutoff()
    corr_cut = _leakage_corr_cutoff()

    for col in list(Xo.columns):
        s = Xo[col]
        nn = s.dropna()
        if len(nn) >= 2 and nn.nunique() == len(nn):
            dropped.append(col)
            Xo = Xo.drop(columns=[col])
            continue
        try:
            if s.equals(y_aligned):
                dropped.append(col)
                Xo = Xo.drop(columns=[col])
                continue
        except Exception:
            pass
        if pd.api.types.is_numeric_dtype(s) and pd.api.types.is_numeric_dtype(y_aligned):
            try:
                pair = pd.concat([s, y_aligned], axis=1, keys=["a", "b"]).dropna()
                if len(pair) >= 5 and pair["a"].nunique() > 1 and pair["b"].nunique() > 1:
                    r = pair["a"].corr(pair["b"])
                    if r is not None and abs(float(r)) >= corr_cut:
                        dropped.append(col)
                        Xo = Xo.drop(columns=[col])
                        continue
            except Exception:
                pass

        # High-cardinality continuous floats: Pearson catches linear clones; NMI is noisy here (false adr drops).
        nmi_applies = True
        if pd.api.types.is_float_dtype(s) and s.nunique(dropna=True) > 50:
            nmi_applies = False

        if nmi_applies:
            try:
                nmi = _nmi_feature_target(s, y_aligned)
                if nmi >= nmi_cut:
                    dropped.append(col)
                    Xo = Xo.drop(columns=[col])
            except Exception:
                pass

    return Xo, dropped


def build_preprocessor(num_cols, cat_cols, use_iterative=True, sparse_ohe: bool = False):
    if use_iterative:
        num_pipe = Pipeline(
            [
                ("writeable", FunctionTransformer(_ensure_writeable_array, validate=False)),
                ("imputer", IterativeImputer(initial_strategy="median")),
                ("scaler", StandardScaler()),
            ]
        )
    else:
        num_pipe = Pipeline(
            [
                ("writeable", FunctionTransformer(_ensure_writeable_array, validate=False)),
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
            ]
        )

    try:
        ohe = OneHotEncoder(handle_unknown="ignore", sparse_output=sparse_ohe)
    except TypeError:
        ohe = OneHotEncoder(handle_unknown="ignore", sparse=sparse_ohe)

    cat_pipe = Pipeline(
        [
            ("writeable", FunctionTransformer(_ensure_writeable_array, validate=False)),
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", ohe),
        ]
    )

    return ColumnTransformer(
        [
            ("num", num_pipe, num_cols),
            ("cat", cat_pipe, cat_cols),
        ]
    )


def get_feature_selector(problem_type, X, scaling_strategy=None):
    k_cap = 10
    if scaling_strategy is not None:
        k_cap = int(getattr(scaling_strategy, "feature_selection_k", 10) or 10)
    k = min(k_cap, X.shape[1])
    return SelectKBest(
        score_func=f_classif if problem_type == "classification" else f_regression,
        k=k,
    )


class _FeatureEngComposite(BaseEstimator, TransformerMixin):
    """
    PCA and/or polynomial features (legacy path when no ScalingStrategy).
    """

    def __init__(self, n_rows: int, n_cols: int):
        self.n_rows = n_rows
        self.n_cols = n_cols

    def fit(self, X, y=None):
        self.pca_ = None
        self.poly_ = None
        X_fit = X
        if self.n_rows <= 5000 and self.n_cols > 20:
            self.pca_ = PCA(n_components=min(20, self.n_cols))
            X_fit = self.pca_.fit_transform(X_fit)
        if self.n_rows <= 5000 and self.n_cols < 15:
            self.poly_ = PolynomialFeatures(degree=2, include_bias=False)
            self.poly_.fit(X_fit)
        return self

    def transform(self, X):
        Xf = X
        if self.pca_ is not None:
            Xf = self.pca_.transform(Xf)
        if self.poly_ is not None:
            Xf = self.poly_.transform(Xf)
        return Xf


class _ScalableFeatureEng(BaseEstimator, TransformerMixin):
    """
    Strategy-driven dimensionality expansion/reduction after feature selection.
    Operates on dense numeric design matrix from upstream steps.
    """

    def __init__(self, n_rows: int, raw_feature_count: int, scaling_strategy: Any):
        self.n_rows = n_rows
        self.raw_feature_count = raw_feature_count
        self.scaling_strategy = scaling_strategy

    def fit(self, X, y=None):
        self.dr_ = None
        self.dr_kind_ = None
        self.poly_ = None
        st = self.scaling_strategy
        n_f = X.shape[1]
        if n_f < 2:
            return self

        X_mid = X

        use_poly = bool(getattr(st, "use_polynomial_features", False)) and not bool(
            getattr(st, "skip_polynomial_entirely", True)
        )
        use_poly = use_poly and n_f < 22 and self.n_rows < 55_000
        if use_poly:
            self.poly_ = PolynomialFeatures(degree=2, include_bias=False)
            X_mid = self.poly_.fit_transform(X)
            n_f = X_mid.shape[1]

        do_dr = bool(getattr(st, "use_pca_or_dr", False))
        n_comp = max(2, min(80, n_f - 1, max(8, n_f // 2)))

        if do_dr and getattr(st, "use_truncated_svd", False) and n_f > 40:
            n_comp = max(2, min(120, n_f - 1))
            self.dr_ = TruncatedSVD(n_components=n_comp, random_state=42)
            self.dr_kind_ = "svd"
            self.dr_.fit(X_mid)
        elif do_dr and getattr(st, "use_incremental_pca", False) and n_f > 10:
            n_comp = max(2, min(60, n_f - 1))
            self.dr_ = IncrementalPCA(n_components=n_comp)
            self.dr_kind_ = "ipca"
            self.dr_.fit(X_mid)
        elif do_dr and n_f > 12:
            n_comp = max(2, min(50, n_f - 1))
            self.dr_ = PCA(n_components=n_comp, random_state=42)
            self.dr_kind_ = "pca"
            self.dr_.fit(X_mid)

        return self

    def transform(self, X):
        Xf = X
        if self.poly_ is not None:
            Xf = self.poly_.transform(Xf)
        if self.dr_ is not None:
            Xf = self.dr_.transform(Xf)
        return Xf


def _legacy_build_feature_engineering(X):
    if X.shape[0] > 5000:
        return "passthrough"
    use_pca = X.shape[1] > 20
    use_poly = X.shape[1] < 15
    if not use_pca and not use_poly:
        return "passthrough"
    return _FeatureEngComposite(n_rows=int(X.shape[0]), n_cols=int(X.shape[1]))


def build_feature_engineering(X, scaling_strategy=None):
    if scaling_strategy is None:
        return _legacy_build_feature_engineering(X)
    has_poly = bool(getattr(scaling_strategy, "use_polynomial_features", False)) and not bool(
        getattr(scaling_strategy, "skip_polynomial_entirely", True)
    )
    has_dr = bool(getattr(scaling_strategy, "use_pca_or_dr", False))
    if not has_poly and not has_dr:
        return "passthrough"
    return _ScalableFeatureEng(
        n_rows=int(X.shape[0]),
        raw_feature_count=int(X.shape[1]),
        scaling_strategy=scaling_strategy,
    )


def _maybe_xgb_classifier(n_jobs: int, n_samples: int):
    try:
        from xgboost import XGBClassifier

        n_est = 100 if n_samples < 50_000 else (70 if n_samples < 150_000 else 55)
        return XGBClassifier(
            n_estimators=n_est,
            max_depth=6 if n_samples < 100_000 else 5,
            learning_rate=0.1,
            tree_method="hist",
            n_jobs=n_jobs,
            random_state=42,
            verbosity=0,
        )
    except Exception:
        return None


def _maybe_xgb_regressor(n_jobs: int, n_samples: int):
    try:
        from xgboost import XGBRegressor

        n_est = 100 if n_samples < 50_000 else (70 if n_samples < 150_000 else 55)
        return XGBRegressor(
            n_estimators=n_est,
            max_depth=6 if n_samples < 100_000 else 5,
            learning_rate=0.1,
            tree_method="hist",
            n_jobs=n_jobs,
            random_state=42,
            verbosity=0,
        )
    except Exception:
        return None


def _maybe_lgbm_classifier(n_jobs: int, n_samples: int):
    try:
        from lightgbm import LGBMClassifier

        n_est = 120 if n_samples < 50_000 else (90 if n_samples < 150_000 else 65)
        return LGBMClassifier(
            n_estimators=n_est,
            max_depth=-1,
            num_leaves=63 if n_samples < 100_000 else 48,
            n_jobs=n_jobs,
            random_state=42,
            verbosity=-1,
        )
    except Exception:
        return None


def _maybe_lgbm_regressor(n_jobs: int, n_samples: int):
    try:
        from lightgbm import LGBMRegressor

        n_est = 120 if n_samples < 50_000 else (90 if n_samples < 150_000 else 65)
        return LGBMRegressor(
            n_estimators=n_est,
            max_depth=-1,
            num_leaves=63 if n_samples < 100_000 else 48,
            n_jobs=n_jobs,
            random_state=42,
            verbosity=-1,
        )
    except Exception:
        return None


def smart_model_selector(X, y, problem_type, scaling_strategy=None):
    n_samples, _ = X.shape
    nj = _parallel_jobs(scaling_strategy)
    models: dict = {}

    if scaling_strategy is None:
        only_scale = n_samples >= 10_000
        allow_slow = n_samples < 10_000
        use_extra_trees = n_samples >= 40_000
    else:
        only_scale = bool(scaling_strategy.use_only_scalable_estimators)
        allow_slow = bool(scaling_strategy.allow_knn_svm)
        use_extra_trees = bool(scaling_strategy.use_xgb_lgbm)

    if problem_type == "classification":
        _ne = 100 if n_samples < 35_000 else (70 if n_samples < 120_000 else 50)
        _md = 18 if n_samples < 35_000 else (14 if n_samples < 120_000 else 10)
        if allow_slow and not only_scale and n_samples < 1000:
            models["KNN"] = KNeighborsClassifier(n_neighbors=min(15, max(3, n_samples // 2)))
            models["NaiveBayes"] = GaussianNB()

        if allow_slow and not only_scale and n_samples < 10_000:
            models["SVM"] = SVC()
            models["Logistic"] = LogisticRegression(max_iter=2000)
            models["DecisionTree"] = DecisionTreeClassifier()

        if n_samples >= 10_000 or only_scale:
            models["RandomForest"] = RandomForestClassifier(
                n_estimators=_ne, max_depth=_md, n_jobs=nj, random_state=42
            )
            models["GradientBoost"] = GradientBoostingClassifier(
                n_estimators=min(100, max(50, _ne)),
                max_depth=3 if n_samples < 80_000 else 2,
                learning_rate=0.1,
                random_state=42,
            )

        if use_extra_trees:
            xgb = _maybe_xgb_classifier(nj, n_samples)
            if xgb is not None:
                models["XGBoost"] = xgb
            lgb = _maybe_lgbm_classifier(nj, n_samples)
            if lgb is not None:
                models["LightGBM"] = lgb
    else:
        _ne = 100 if n_samples < 35_000 else (70 if n_samples < 120_000 else 50)
        _md = 18 if n_samples < 35_000 else (14 if n_samples < 120_000 else 10)
        if allow_slow and not only_scale and n_samples < 1000:
            models["KNN"] = KNeighborsRegressor(n_neighbors=min(15, max(3, n_samples // 2)))

        if allow_slow and not only_scale and n_samples < 10_000:
            models["SVR"] = SVR()
            models["Linear"] = LinearRegression()
            models["DecisionTree"] = DecisionTreeRegressor()

        if n_samples >= 10_000 or only_scale:
            models["RandomForest"] = RandomForestRegressor(
                n_estimators=_ne, max_depth=_md, n_jobs=nj, random_state=42
            )
            models["GradientBoost"] = GradientBoostingRegressor(
                n_estimators=min(100, max(50, _ne)),
                max_depth=3 if n_samples < 80_000 else 2,
                learning_rate=0.1,
                random_state=42,
            )

        if use_extra_trees:
            xgb = _maybe_xgb_regressor(nj, n_samples)
            if xgb is not None:
                models["XGBoost"] = xgb
            lgb = _maybe_lgbm_regressor(nj, n_samples)
            if lgb is not None:
                models["LightGBM"] = lgb

    if scaling_strategy is not None:
        cap = int(getattr(scaling_strategy, "cv_max_models", 4) or 4)
        cap = max(1, min(cap, 8))
        if len(models) > cap:
            pri_c = [
                "LightGBM",
                "XGBoost",
                "RandomForest",
                "GradientBoost",
                "Logistic",
                "DecisionTree",
                "NaiveBayes",
                "SVM",
                "KNN",
            ]
            pri_r = [
                "LightGBM",
                "XGBoost",
                "RandomForest",
                "GradientBoost",
                "Linear",
                "DecisionTree",
                "SVR",
                "KNN",
            ]
            pri = pri_c if problem_type == "classification" else pri_r
            order = []
            for p in pri:
                if p in models:
                    order.append(p)
            for k in models.keys():
                if k not in order:
                    order.append(k)
            models = {k: models[k] for k in order[:cap]}

    print("Selected Models:", list(models.keys()))
    return models


def build_ensemble(models, problem_type):
    estimators = [(name, model) for name, model in models.items()]

    if problem_type == "classification":
        return StackingClassifier(
            estimators=estimators,
            final_estimator=LogisticRegression(max_iter=2000),
        )
    return StackingRegressor(
        estimators=estimators,
        final_estimator=LinearRegression(),
    )


def train_models_core(X, y, preprocessor, selector, problem_type, scaling_strategy=None):
    models = smart_model_selector(X, y, problem_type, scaling_strategy)
    cap = 4
    if scaling_strategy is not None:
        cap = int(getattr(scaling_strategy, "cv_max_models", 4) or 4)
    if _memory_safe_mode():
        cap = min(3, cap)
    cap = max(1, min(cap, 8))
    models = dict(list(models.items())[:cap])
    scores = {}

    if scaling_strategy is not None and hasattr(scaling_strategy, "cv_sample_cap"):
        sample_cap = int(scaling_strategy.cv_sample_cap)
    else:
        sample_cap = 3000 if _memory_safe_mode() else 5000
    sample_cap = max(100, sample_cap)
    if X.shape[0] > sample_cap:
        X_sample = X.sample(sample_cap, random_state=42)
        y_sample = y.loc[X_sample.index]
    else:
        X_sample, y_sample = X, y

    pref_splits = 2 if _memory_safe_mode() else 3
    cv = _safe_cv(
        problem_type,
        y_sample,
        preferred_splits=pref_splits,
        scaling_strategy=scaling_strategy,
    )

    scoring = "f1_weighted" if problem_type == "classification" else "r2"

    sampler_step = _imbalance_sampler_step(
        problem_type, y_sample, n_rows_for_size_choice=X.shape[0]
    )
    if sampler_step is not None:
        print(
            f"Imbalanced classes: CV uses {sampler_step[0]} after preprocessing "
            f"(dataset rows={X.shape[0]}, CV subsample rows={X_sample.shape[0]})."
        )

    for name, model in models.items():
        pipe = _assemble_model_pipeline(
            preprocessor,
            selector,
            build_feature_engineering(X, scaling_strategy),
            model,
            sampler_step,
        )

        score = cross_val_score(
            pipe, X_sample, y_sample, cv=cv, scoring=scoring, n_jobs=_parallel_jobs(scaling_strategy)
        ).mean()
        scores[name] = {scoring: score}
        print(f"{name} ({scoring}): {score:.4f}")

    return scores


def final_training(X, y, preprocessor, selector, best_model, problem_type, scaling_strategy=None):
    _ = scaling_strategy
    stratify_target = None
    if problem_type == "classification" and _classification_min_count(y) >= 2:
        stratify_target = y

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=42,
        stratify=stratify_target,
    )

    sampler_step = _imbalance_sampler_step(
        problem_type, y_train, n_rows_for_size_choice=X.shape[0]
    )
    if sampler_step is not None:
        print(
            f"Imbalanced classes: fitting with {sampler_step[0]} after preprocessing "
            f"(dataset rows={X.shape[0]})."
        )

    pipe = _assemble_model_pipeline(
        preprocessor,
        selector,
        build_feature_engineering(X, scaling_strategy),
        best_model,
        sampler_step,
    )

    pipe.fit(X_train, y_train)
    return pipe, X_train, X_test, y_train, y_test


def evaluate(pipe, X_train, X_test, y_train, y_test, problem_type):
    y_pred_train = pipe.predict(X_train)
    y_pred_test = pipe.predict(X_test)

    roc = None
    if problem_type == "classification" and hasattr(pipe, "predict_proba"):
        try:
            proba = pipe.predict_proba(X_test)
            if len(np.unique(y_test)) == 2:
                roc = roc_auc_score(y_test, proba[:, 1])
            else:
                roc = roc_auc_score(y_test, proba, multi_class="ovr")
        except Exception:
            roc = None

    if problem_type == "classification":
        return {
            "train_acc": accuracy_score(y_train, y_pred_train),
            "test_acc": accuracy_score(y_test, y_pred_test),
            "f1": f1_score(y_test, y_pred_test, average="weighted", zero_division=0),
            "precision": precision_score(
                y_test, y_pred_test, average="weighted", zero_division=0
            ),
            "recall": recall_score(
                y_test, y_pred_test, average="weighted", zero_division=0
            ),
            "roc_auc": roc,
        }
    try:
        rmse = mean_squared_error(y_test, y_pred_test, squared=False)
    except TypeError:
        # Older scikit-learn versions do not support the "squared" argument.
        rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))

    return {
        "train_r2": r2_score(y_train, y_pred_train),
        "test_r2": r2_score(y_test, y_pred_test),
        "mae": mean_absolute_error(y_test, y_pred_test),
        "rmse": float(rmse),
    }


def run_automl(file_path, target_col):
    print("AUTO ML DOCTOR STARTED\n")

    df = load_csv(file_path)
    X, y = split_features_target(df, target_col)
    num_cols, cat_cols = infer_column_types(X)

    problem_type = detect_problem_type(y)
    print("Problem Type:", problem_type)

    pre = build_preprocessor(num_cols, cat_cols, use_iterative=(X.shape[0] < 2000))
    selector = get_feature_selector(problem_type, X)

    scores = train_models_core(X, y, pre, selector, problem_type)

    if problem_type == "classification":
        sorted_scores = sorted(
            [(model_name, metrics["f1_weighted"]) for model_name, metrics in scores.items()],
            key=lambda item: item[1],
            reverse=True,
        )
    else:
        sorted_scores = sorted(
            [(model_name, metrics["r2"]) for model_name, metrics in scores.items()],
            key=lambda item: item[1],
            reverse=True,
        )

    top_models = [name for name, _ in sorted_scores[:4]]

    models_dict = smart_model_selector(X, y, problem_type, scaling)
    selected_models = {name: models_dict[name] for name in top_models if name in models_dict}

    use_ensemble = False
    min_class_count = (
        _classification_min_count(y) if problem_type == "classification" else None
    )
    if (
        len(sorted_scores) > 1
        and abs(sorted_scores[0][1] - sorted_scores[1][1]) < 0.02
        and (problem_type != "classification" or (min_class_count is not None and min_class_count >= 2))
    ):
        use_ensemble = True

    if use_ensemble and len(selected_models) > 1:
        best_model = build_ensemble(selected_models, problem_type)
        print("\nAuto-Ensemble of Top Models:", top_models)
    else:
        best_model = list(selected_models.values())[0]
        print("\nBest Single Model:", top_models[0])

    model, X_train, X_test, y_train, y_test = final_training(
        X, y, pre, selector, best_model, problem_type, scaling
    )

    eval_metrics = evaluate(model, X_train, X_test, y_train, y_test, problem_type)
    print("\nEvaluation:", eval_metrics)

    return model, eval_metrics, scores
