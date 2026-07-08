import argparse
import json
import re
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import FunctionTransformer, StandardScaler, OneHotEncoder, OrdinalEncoder, TargetEncoder
from sklearn.impute import SimpleImputer
from sklearn.feature_selection import SelectKBest, f_classif, f_regression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, r2_score, mean_absolute_error, mean_squared_error
from sklearn.experimental import enable_iterative_imputer  # noqa: F401
from sklearn.impute import IterativeImputer
from sklearn.preprocessing import PolynomialFeatures
from sklearn.ensemble import StackingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC
from sklearn.naive_bayes import GaussianNB


TARGET_COL_DEFAULT = "target"
PROBLEM_TYPE = "classification"
FINAL_MODEL_NAME = "Ensemble"
SELECTED_VERSION = "original"
ROW_COUNT = 302
FEATURE_COUNT = 13
PREPROCESSING_STRATEGY = "IterativeImputer + StandardScaler + OneHotEncoder"
FEATURE_ENGINEERING_STRATEGY = "PolynomialFeatures"


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


def build_preprocessor(num_cols, cat_cols, use_iterative=False, X=None):
    num_pipe = Pipeline(
        [
            ("writeable", FunctionTransformer(_ensure_writeable_array, validate=False)),
            ("imputer", IterativeImputer(initial_strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )

    if X is not None and cat_cols:
        high_card_cats = [
            c for c in cat_cols if c in X.columns and X[c].nunique(dropna=True) > 10
        ]
        low_card_cats = [c for c in cat_cols if c not in high_card_cats]
        ordered_cats = [
            c for c in low_card_cats if _detect_ordered_categoricals(X[c])
        ]
        nominal_cats = [c for c in low_card_cats if c not in ordered_cats]
    else:
        high_card_cats = []
        ordered_cats = []
        nominal_cats = cat_cols

    transformers = [("num", num_pipe, num_cols)]

    if nominal_cats:
        nominal_pipe = Pipeline(
            [
                ("writeable", FunctionTransformer(_ensure_writeable_array, validate=False)),
                ("imputer", SimpleImputer(strategy="most_frequent", add_indicator=True)),
                ("encoder", OneHotEncoder(handle_unknown="ignore")),
            ]
        )
        transformers.append(("cat_nominal", nominal_pipe, nominal_cats))

    if ordered_cats:
        ordered_pipe = Pipeline(
            [
                ("writeable", FunctionTransformer(_ensure_writeable_array, validate=False)),
                ("imputer", SimpleImputer(strategy="most_frequent", add_indicator=True)),
                ("encoder", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
            ]
        )
        transformers.append(("cat_ordered", ordered_pipe, ordered_cats))

    if high_card_cats:
        high_card_pipe = Pipeline(
            [
                ("writeable", FunctionTransformer(_ensure_writeable_array, validate=False)),
                ("imputer", SimpleImputer(strategy="most_frequent", add_indicator=True)),
                ("encoder", TargetEncoder(random_state=42)),
            ]
        )
        transformers.append(("cat_high", high_card_pipe, high_card_cats))

    return ColumnTransformer(transformers)


def get_feature_selector(problem_type, x):
    k = min(10, x.shape[1])
    return SelectKBest(score_func=f_classif if problem_type == "classification" else f_regression, k=k)


def build_feature_engineering(x):
    return Pipeline([
        ("eng", PolynomialFeatures(degree=2, include_bias=False, interaction_only=True)),
    ]) if FEATURE_ENGINEERING_STRATEGY != "passthrough" else "passthrough"


def build_final_model():
    estimators = [
        ("KNN", KNeighborsClassifier()),
        ("SVM", SVC(probability=True)),
        ("Logistic", LogisticRegression(max_iter=2000)),
        ("NaiveBayes", GaussianNB()),
    ]
    return StackingClassifier(estimators=estimators, final_estimator=LogisticRegression(max_iter=2000))



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

    pre = build_preprocessor(num_cols, cat_cols, use_iterative=True, X=x)
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
