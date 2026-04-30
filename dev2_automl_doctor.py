import pandas as pd
import numpy as np

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
)

from sklearn.experimental import enable_iterative_imputer  # noqa: F401
from sklearn.impute import IterativeImputer
from sklearn.preprocessing import PolynomialFeatures
from sklearn.decomposition import PCA
from sklearn.model_selection import StratifiedKFold, KFold


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


def _safe_cv(problem_type, y, preferred_splits=3):
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


def build_preprocessor(num_cols, cat_cols, use_iterative=True):
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

    cat_pipe = Pipeline(
        [
            ("writeable", FunctionTransformer(_ensure_writeable_array, validate=False)),
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore")),
        ]
    )

    return ColumnTransformer(
        [
            ("num", num_pipe, num_cols),
            ("cat", cat_pipe, cat_cols),
        ]
    )


def get_feature_selector(problem_type, X):
    k = min(10, X.shape[1])
    return SelectKBest(
        score_func=f_classif if problem_type == "classification" else f_regression,
        k=k,
    )


def build_feature_engineering(X):
    if X.shape[0] > 5000:
        return "passthrough"

    steps = []
    if X.shape[1] > 20:
        steps.append(("pca", PCA(n_components=min(20, X.shape[1]))))
    if X.shape[1] < 15:
        steps.append(("poly", PolynomialFeatures(degree=2, include_bias=False)))
    return Pipeline(steps) if steps else "passthrough"


def smart_model_selector(X, y, problem_type):
    n_samples, _ = X.shape
    models = {}

    imbalance = False
    if problem_type == "classification":
        dist = y.value_counts(normalize=True)
        imbalance = dist.min() < 0.2

    if problem_type == "classification":
        if n_samples < 1000:
            models["KNN"] = KNeighborsClassifier()
            models["NaiveBayes"] = GaussianNB()

        if n_samples < 10000:
            models["SVM"] = SVC()
            models["Logistic"] = LogisticRegression(max_iter=2000)
            models["DecisionTree"] = DecisionTreeClassifier()

        if n_samples >= 10000:
            models["RandomForest"] = RandomForestClassifier()
            models["GradientBoost"] = GradientBoostingClassifier()

        if imbalance:
            models["BalancedRF"] = RandomForestClassifier(class_weight="balanced")
    else:
        if n_samples < 1000:
            models["KNN"] = KNeighborsRegressor()

        if n_samples < 10000:
            models["SVR"] = SVR()
            models["Linear"] = LinearRegression()
            models["DecisionTree"] = DecisionTreeRegressor()

        if n_samples >= 10000:
            models["RandomForest"] = RandomForestRegressor()
            models["GradientBoost"] = GradientBoostingRegressor()

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


def train_models_core(X, y, preprocessor, selector, problem_type):
    models = smart_model_selector(X, y, problem_type)
    models = dict(list(models.items())[:4])
    scores = {}

    if X.shape[0] > 5000:
        X_sample = X.sample(5000, random_state=42)
        y_sample = y.loc[X_sample.index]
    else:
        X_sample, y_sample = X, y

    cv = _safe_cv(problem_type, y_sample, preferred_splits=3)

    scoring = "f1_weighted" if problem_type == "classification" else "r2"

    for name, model in models.items():
        pipe = Pipeline(
            [
                ("pre", preprocessor),
                ("feat", selector),
                ("eng", build_feature_engineering(X)),
                ("model", model),
            ]
        )

        score = cross_val_score(
            pipe, X_sample, y_sample, cv=cv, scoring=scoring, n_jobs=-1
        ).mean()
        scores[name] = {scoring: score}
        print(f"{name} ({scoring}): {score:.4f}")

    return scores


def final_training(X, y, preprocessor, selector, best_model, problem_type):
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

    pipe = Pipeline(
        [
            ("pre", preprocessor),
            ("feat", selector),
            ("eng", build_feature_engineering(X)),
            ("model", best_model),
        ]
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
    return {
        "train_r2": r2_score(y_train, y_pred_train),
        "test_r2": r2_score(y_test, y_pred_test),
        "mae": mean_absolute_error(y_test, y_pred_test),
        "rmse": mean_squared_error(y_test, y_pred_test, squared=False),
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

    models_dict = smart_model_selector(X, y, problem_type)
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
        X, y, pre, selector, best_model, problem_type
    )

    eval_metrics = evaluate(model, X_train, X_test, y_train, y_test, problem_type)
    print("\nEvaluation:", eval_metrics)

    return model, eval_metrics, scores
