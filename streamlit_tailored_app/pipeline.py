"""
Pipeline helpers aligned with the AutoML tailored notebook export (heuristics + sklearn).
"""
from __future__ import annotations

import re
from functools import partial

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.decomposition import PCA
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.experimental import enable_iterative_imputer  # noqa: F401
from sklearn.feature_selection import SelectKBest, f_classif, f_regression
from sklearn.impute import IterativeImputer, SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import (
    FunctionTransformer,
    OneHotEncoder,
    OrdinalEncoder,
    PolynomialFeatures,
    StandardScaler,
    TargetEncoder,
)
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

CLASSIFIER_MODELS = {
    "Logistic": lambda: LogisticRegression(max_iter=2000),
    "SVM": lambda: SVC(probability=True),
    "KNN": lambda: KNeighborsClassifier(),
    "DecisionTree": lambda: DecisionTreeClassifier(),
    "RandomForest": lambda: RandomForestClassifier(),
    "GradientBoost": lambda: GradientBoostingClassifier(),
    "NaiveBayes": lambda: GaussianNB(),
}

REGRESSOR_MODELS = {
    "Linear": lambda: LinearRegression(),
    "SVR": lambda: SVR(),
    "KNN": lambda: KNeighborsRegressor(),
    "DecisionTree": lambda: DecisionTreeRegressor(),
    "RandomForest": lambda: RandomForestRegressor(),
    "GradientBoost": lambda: GradientBoostingRegressor(),
}


def detect_problem_type(y: pd.Series) -> str:
    s = y.dropna()
    if s.nunique() <= 20 and not pd.api.types.is_float_dtype(s) and s.nunique() < max(5, len(s) * 0.1):
        return "classification"
    if pd.api.types.is_numeric_dtype(s) and s.nunique() > 20:
        return "regression"
    if s.nunique() <= 20:
        return "classification"
    return "regression"


def compute_heuristics(row_count: int, feature_count: int) -> dict:
    return {
        "use_iterative": row_count > 0 and row_count < 2000,
        "use_pca": row_count <= 5000 and feature_count > 20,
        "use_poly": row_count <= 5000 and feature_count < 15,
    }


def get_estimator(problem_type: str, model_name: str):
    if problem_type == "classification":
        factory = CLASSIFIER_MODELS.get(model_name)
    else:
        factory = REGRESSOR_MODELS.get(model_name)
    if factory is None:
        raise ValueError(f"Unknown model {model_name!r} for {problem_type}")
    return factory()


def _detect_ordered_categoricals(series: pd.Series) -> bool:
    """Check if a categorical column represents ordered values."""
    vals = series.dropna().unique()
    if len(vals) < 3:
        return False
    lower = {str(v).strip().lower() for v in vals}

    ordinal_sets = [
        {"low", "medium", "high"},
        {"small", "medium", "large"},
        {"beginner", "intermediate", "advanced"},
        {"cold", "warm", "hot"},
        {"poor", "average", "good", "excellent"},
        {"basic", "standard", "premium"},
        {"min", "max"},
        {"never", "rarely", "sometimes", "often", "always"},
        {"none", "some", "all"},
    ]
    for ref in ordinal_sets:
        if lower == ref or lower.issuperset(ref):
            return True

    try:
        nums = [int(re.sub(r"[^0-9\-]", "", v)) for v in vals if re.sub(r"[^0-9\-]", "", v)]
        if len(nums) >= 3 and len(nums) == len(vals):
            return True
    except (ValueError, TypeError):
        pass

    return False


def build_num_cat_pipes(use_iterative: bool, X=None, cat_cols=None):
    num_imputer = (
        ("imputer", IterativeImputer(initial_strategy="median"))
        if use_iterative
        else ("imputer", SimpleImputer(strategy="median", add_indicator=True))
    )
    num_pipe = Pipeline(
        [
            ("writeable", FunctionTransformer(partial(np.array, copy=True), validate=False)),
            num_imputer,
            ("scaler", StandardScaler()),
        ]
    )

    if X is not None and cat_cols:
        high_card = [
            c for c in cat_cols if c in X.columns and X[c].nunique(dropna=True) > 10
        ]
        low_card = [c for c in cat_cols if c not in high_card]
        ordered = [c for c in low_card if _detect_ordered_categoricals(X[c])]
        nominal = [c for c in low_card if c not in ordered]
    else:
        high_card, ordered, nominal = [], [], cat_cols or []

    nominal_pipe = Pipeline(
        [
            ("writeable", FunctionTransformer(partial(np.array, copy=True), validate=False)),
            ("imputer", SimpleImputer(strategy="most_frequent", add_indicator=True)),
            ("encoder", OneHotEncoder(handle_unknown="ignore")),
        ]
    )

    ordered_pipe = None
    if ordered:
        ordered_pipe = Pipeline(
            [
                ("writeable", FunctionTransformer(partial(np.array, copy=True), validate=False)),
                ("imputer", SimpleImputer(strategy="most_frequent", add_indicator=True)),
                ("encoder", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
            ]
        )

    high_card_pipe = None
    if high_card:
        high_card_pipe = Pipeline(
            [
                ("writeable", FunctionTransformer(partial(np.array, copy=True), validate=False)),
                ("imputer", SimpleImputer(strategy="most_frequent", add_indicator=True)),
                ("encoder", TargetEncoder(random_state=42)),
            ]
        )

    return num_pipe, nominal_pipe, nominal, ordered_pipe, ordered, high_card_pipe, high_card


def build_feature_engineering(x: pd.DataFrame, use_pca: bool, use_poly: bool):
    if use_pca:
        return Pipeline([("eng", PCA(n_components=min(20, x.shape[1])))])
    if use_poly:
        return Pipeline([("eng", PolynomialFeatures(degree=2, include_bias=False, interaction_only=True))])
    return "passthrough"


def build_full_pipeline(
    x: pd.DataFrame,
    y: pd.Series,
    problem_type: str,
    model_name: str,
    test_size: float = 0.2,
    random_state: int = 42,
):
    row_count = len(x)
    feature_count = x.shape[1]
    h = compute_heuristics(row_count, feature_count)

    num_cols = list(x.select_dtypes(include=["int64", "float64"]).columns)
    cat_cols = [c for c in x.columns if c not in num_cols]

    pipes = build_num_cat_pipes(h["use_iterative"], X=x, cat_cols=cat_cols)
    num_pipe, nominal_pipe, nominal, ordered_pipe, ordered, high_card_pipe, high_card = pipes
    ct_transformers = [("num", num_pipe, num_cols)]
    if nominal:
        ct_transformers.append(("cat_nominal", nominal_pipe, nominal))
    elif cat_cols and not ordered and not high_card:
        ct_transformers.append(("cat", nominal_pipe, cat_cols))
    if ordered_pipe is not None and ordered:
        ct_transformers.append(("cat_ordered", ordered_pipe, ordered))
    if high_card_pipe is not None and high_card:
        ct_transformers.append(("cat_high", high_card_pipe, high_card))
    pre = ColumnTransformer(ct_transformers)

    score_f = f_classif if problem_type == "classification" else f_regression
    selector = SelectKBest(score_func=score_f, k=min(10, x.shape[1]))
    eng = build_feature_engineering(x, h["use_pca"], h["use_poly"])
    model = get_estimator(problem_type, model_name)

    stratify = None
    if problem_type == "classification" and y.value_counts().min() >= 2:
        stratify = y

    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=test_size,
        random_state=random_state,
        stratify=stratify,
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

    metrics = evaluate_pipeline(pipe, x_train, x_test, y_train, y_test, problem_type)
    meta = {
        **h,
        "preprocessing_strategy": (
            "IterativeImputer + StandardScaler + OneHotEncoder"
            if h["use_iterative"]
            else "SimpleImputer + StandardScaler + OneHotEncoder"
        ),
        "feature_engineering_strategy": (
            "PCA" if h["use_pca"] else "PolynomialFeatures" if h["use_poly"] else "passthrough"
        ),
        "numeric_columns": num_cols,
        "categorical_columns": cat_cols,
    }
    return pipe, metrics, meta, x_train, x_test, y_train, y_test


def evaluate_pipeline(pipe, x_train, x_test, y_train, y_test, problem_type: str) -> dict:
    y_pred_train = pipe.predict(x_train)
    y_pred_test = pipe.predict(x_test)
    if problem_type == "classification":
        return {
            "train_acc": float(accuracy_score(y_train, y_pred_train)),
            "test_acc": float(accuracy_score(y_test, y_pred_test)),
            "f1": float(f1_score(y_test, y_pred_test, average="weighted", zero_division=0)),
            "precision": float(
                precision_score(y_test, y_pred_test, average="weighted", zero_division=0)
            ),
            "recall": float(recall_score(y_test, y_pred_test, average="weighted", zero_division=0)),
        }
    try:
        rmse = mean_squared_error(y_test, y_pred_test, squared=False)
    except TypeError:
        rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))
    return {
        "train_r2": float(r2_score(y_train, y_pred_train)),
        "test_r2": float(r2_score(y_test, y_pred_test)),
        "mae": float(mean_absolute_error(y_test, y_pred_test)),
        "rmse": float(rmse),
    }


def fit_full_dataset(pipe: Pipeline, x: pd.DataFrame, y: pd.Series) -> Pipeline:
    """Clone and refit on all rows (production model)."""
    from sklearn.base import clone

    full = clone(pipe)
    full.fit(x, y)
    return full
