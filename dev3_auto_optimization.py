from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

import numpy as np
from sklearn.base import clone
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import accuracy_score, r2_score
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.pipeline import Pipeline
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor


@dataclass
class ScoreBundle:
    train: float
    test: float
    metric_name: str


def evaluate_model(model, X_train, X_test, y_train, y_test, problem_type) -> ScoreBundle:
    train_pred = model.predict(X_train)
    test_pred = model.predict(X_test)

    if problem_type == "classification":
        train_score = accuracy_score(y_train, train_pred)
        test_score = accuracy_score(y_test, test_pred)
        return ScoreBundle(train=train_score, test=test_score, metric_name="accuracy")

    train_score = r2_score(y_train, train_pred)
    test_score = r2_score(y_test, test_pred)
    return ScoreBundle(train=train_score, test=test_score, metric_name="r2")


def detect_issues(train_score: float, test_score: float, problem_type: str, n_samples: int) -> str:
    # Dynamic overfit threshold: stricter for larger datasets, looser for smaller ones.
    base_gap = 0.08 if problem_type == "classification" else 0.12
    sample_adjustment = min(0.04, max(0.0, (2000 - n_samples) / 50000))
    overfit_gap = base_gap + sample_adjustment

    if (train_score - test_score) > overfit_gap:
        return "overfitting"

    # Dynamic low-performance threshold by task type.
    if problem_type == "classification":
        low_perf_threshold = 0.70
    else:
        # For R2, values below ~0.25 usually indicate weak fit.
        low_perf_threshold = 0.25

    if train_score < low_perf_threshold and test_score < low_perf_threshold:
        return "underfitting"

    return "good"


def check_imbalance(y_train) -> bool:
    ratio = y_train.value_counts(normalize=True)
    if len(ratio) <= 1:
        return False

    minority_ratio = ratio.min()
    majority_to_minority = ratio.max() / max(minority_ratio, 1e-9)

    return minority_ratio < 0.2 or majority_to_minority > 4.0


def _dynamic_forest_size(n_samples: int, n_features: int, issue: str) -> int:
    if issue == "underfitting":
        base = 300
    elif issue == "overfitting":
        base = 120
    else:
        base = 200

    size_factor = min(1.5, max(0.8, np.log1p(max(n_samples, 10)) / 6.0))
    feat_factor = min(1.4, max(0.8, np.log1p(max(n_features, 2)) / 4.0))

    n_estimators = int(base * size_factor * feat_factor)
    return int(np.clip(n_estimators, 80, 600))


def _dynamic_neighbors(n_samples: int) -> int:
    # Keep odd k and avoid too-high neighborhood sizes.
    k = int(np.sqrt(max(n_samples, 5)))
    if k % 2 == 0:
        k += 1
    return int(np.clip(k, 3, 35))


def _safe_tree_depth(n_features: int, issue: str):
    if issue == "underfitting":
        return None
    if issue == "overfitting":
        return max(3, min(12, int(np.log2(max(n_features, 2)) * 1.8)))
    return max(4, min(16, int(np.log2(max(n_features, 2)) * 2.2)))


def _build_candidate_estimators(
    problem_type: str,
    issue: str,
    imbalance: bool,
    n_samples: int,
    n_features: int,
    random_state: int = 42,
) -> Dict[str, Any]:
    """
    Build improved candidates across Dev2 algorithm family.
    Returns estimator objects (unfitted).
    """
    n_estimators = _dynamic_forest_size(n_samples, n_features, issue)
    k_neighbors = _dynamic_neighbors(n_samples)
    max_features_reg = max(0.33, min(0.8, np.sqrt(max(n_features, 1)) / max(n_features, 1)))

    if problem_type == "classification":
        class_weight = "balanced" if imbalance else None
        logistic_c = 0.7 if issue == "overfitting" else (2.0 if issue == "underfitting" else 1.0)
        svc_c = 0.8 if issue == "overfitting" else (2.0 if issue == "underfitting" else 1.0)

        candidates = {
            "Logistic": LogisticRegression(
                max_iter=4000,
                C=logistic_c,
                class_weight=class_weight,
                solver="lbfgs",
            ),
            "SVM": SVC(
                C=svc_c,
                kernel="rbf",
                gamma="scale",
                class_weight=class_weight,
                probability=True,
            ),
            "KNN": KNeighborsClassifier(
                n_neighbors=k_neighbors,
                weights="distance" if issue == "overfitting" else "uniform",
            ),
            "DecisionTree": DecisionTreeClassifier(
                max_depth=_safe_tree_depth(n_features, issue),
                min_samples_leaf=2 if issue == "overfitting" else 1,
                class_weight=class_weight,
                random_state=random_state,
            ),
            "RandomForest": RandomForestClassifier(
                n_estimators=n_estimators,
                max_depth=_safe_tree_depth(n_features, issue),
                min_samples_leaf=2 if issue == "overfitting" else 1,
                max_features="sqrt",
                class_weight=class_weight,
                random_state=random_state,
                n_jobs=-1,
            ),
            "GradientBoost": GradientBoostingClassifier(
                n_estimators=max(80, int(n_estimators * 0.6)),
                learning_rate=0.05 if issue == "overfitting" else 0.1,
                max_depth=2 if issue == "overfitting" else 3,
                random_state=random_state,
            ),
            "NaiveBayes": GaussianNB(
                var_smoothing=1e-8 if issue == "overfitting" else 1e-9
            ),
        }

        if imbalance:
            candidates["BalancedRF"] = RandomForestClassifier(
                n_estimators=n_estimators,
                max_depth=_safe_tree_depth(n_features, issue),
                min_samples_leaf=2 if issue == "overfitting" else 1,
                max_features="sqrt",
                class_weight="balanced",
                random_state=random_state,
                n_jobs=-1,
            )
        return candidates

    svr_c = 0.8 if issue == "overfitting" else (3.0 if issue == "underfitting" else 1.5)
    svr_epsilon = 0.2 if issue == "overfitting" else 0.1

    return {
        "Linear": LinearRegression(),
        "SVR": SVR(
            C=svr_c,
            epsilon=svr_epsilon,
            kernel="rbf",
            gamma="scale",
        ),
        "KNN": KNeighborsRegressor(
            n_neighbors=k_neighbors,
            weights="distance" if issue == "overfitting" else "uniform",
        ),
        "DecisionTree": DecisionTreeRegressor(
            max_depth=_safe_tree_depth(n_features, issue),
            min_samples_leaf=2 if issue == "overfitting" else 1,
            random_state=random_state,
        ),
        "RandomForest": RandomForestRegressor(
            n_estimators=n_estimators,
            max_depth=_safe_tree_depth(n_features, issue),
            min_samples_leaf=2 if issue == "overfitting" else 1,
            max_features=max_features_reg,
            random_state=random_state,
            n_jobs=-1,
        ),
        "GradientBoost": GradientBoostingRegressor(
            n_estimators=max(80, int(n_estimators * 0.6)),
            learning_rate=0.05 if issue == "overfitting" else 0.1,
            max_depth=2 if issue == "overfitting" else 3,
            random_state=random_state,
        ),
    }


def improve_model(
    problem_type: str,
    issue: str,
    imbalance: bool,
    n_samples: int,
    n_features: int,
    random_state: int = 42,
):
    # Backward-compatible wrapper: now returns all improved candidates.
    return _build_candidate_estimators(
        problem_type=problem_type,
        issue=issue,
        imbalance=imbalance,
        n_samples=n_samples,
        n_features=n_features,
        random_state=random_state,
    )


def _fit_candidate_in_same_structure(original_model, candidate_estimator, X_train, y_train):
    """
    Keep Dev2 structure intact:
    - If original model is a Pipeline, swap only final estimator.
    - Otherwise, fit candidate estimator directly.
    """
    if isinstance(original_model, Pipeline):
        optimized_pipeline = clone(original_model)
        optimized_pipeline.set_params(model=candidate_estimator)
        optimized_pipeline.fit(X_train, y_train)
        return optimized_pipeline

    candidate = clone(candidate_estimator)
    candidate.fit(X_train, y_train)
    return candidate


def optimize_model(
    model,
    X_train,
    X_test,
    y_train,
    y_test,
    problem_type: str,
    random_state: int = 42,
) -> Dict[str, Any]:
    before = evaluate_model(model, X_train, X_test, y_train, y_test, problem_type)
    issue = detect_issues(before.train, before.test, problem_type, n_samples=len(X_train))

    imbalance = False
    if problem_type == "classification":
        imbalance = check_imbalance(y_train)

    candidate_estimators = improve_model(
        problem_type=problem_type,
        issue=issue,
        imbalance=imbalance,
        n_samples=len(X_train),
        n_features=X_train.shape[1],
        random_state=random_state,
    )

    best_candidate_name = None
    best_candidate_estimator = None
    best_candidate_model = None
    best_candidate_scores = None
    candidate_scores = {}
    failed_candidates = {}

    for name, estimator in candidate_estimators.items():
        try:
            fitted_model = _fit_candidate_in_same_structure(
                original_model=model,
                candidate_estimator=estimator,
                X_train=X_train,
                y_train=y_train,
            )
            scores = evaluate_model(
                fitted_model, X_train, X_test, y_train, y_test, problem_type
            )
            candidate_scores[name] = {"train": scores.train, "test": scores.test}

            if best_candidate_scores is None or scores.test > best_candidate_scores.test:
                best_candidate_name = name
                best_candidate_estimator = estimator
                best_candidate_model = fitted_model
                best_candidate_scores = scores
        except Exception as exc:  # pragma: no cover - depends on data/model combo
            failed_candidates[name] = str(exc)

    if best_candidate_scores is None:
        # Nothing could be trained successfully, keep original.
        after = before
        final_model = model
        final_train = before.train
        final_test = before.test
        selected_version = "original"
    else:
        after = best_candidate_scores
        if after.test >= before.test:
            final_model = best_candidate_model
            final_train = after.train
            final_test = after.test
            selected_version = "improved"
        else:
            final_model = model
            final_train = before.train
            final_test = before.test
            selected_version = "original"

    return {
        "metric": before.metric_name,
        "before_train": before.train,
        "before_test": before.test,
        "after_train": after.train,
        "after_test": after.test,
        "final_train": final_train,
        "final_test": final_test,
        "final_model": final_model,
        "issue_detected": issue,
        "imbalance_detected": imbalance,
        "selected_model_version": selected_version,
        "best_candidate_name": best_candidate_name,
        "candidate_model": best_candidate_estimator,
        "candidate_scores": candidate_scores,
        "failed_candidates": failed_candidates,
    }

