"""
Resolve expected features and dtypes from a pickled sklearn Pipeline (AutoML run).
Column order must match training — only sklearn's feature_names_in_ (or equivalent) is trusted.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def _walk_estimators(est: Any, depth: int = 0) -> Iterator[Any]:
    """Depth-first walk of nested Pipelines / ensembles / calibrators."""
    if depth > 20:
        return
    yield est
    if hasattr(est, "named_steps"):
        for step in est.named_steps.values():
            yield from _walk_estimators(step, depth + 1)
    if hasattr(est, "estimators_"):
        for sub in getattr(est, "estimators_", []) or []:
            yield from _walk_estimators(sub, depth + 1)
    base = getattr(est, "base_estimator", None) or getattr(est, "estimator", None)
    if base is not None:
        yield from _walk_estimators(base, depth + 1)
    cal = getattr(est, "calibrated_classifiers_", None)
    if cal:
        for c in cal:
            inner = getattr(c, "estimator", None) or getattr(c, "base_estimator", None)
            if inner is not None:
                yield from _walk_estimators(inner, depth + 1)


def infer_expected_columns(model: Any) -> list[str]:
    """
    Training column order — required for predict(DataFrame).
    Uses the first estimator in outer-first walk that defines feature_names_in_ — normally the
    top-level Pipeline matching raw input columns. Inner steps (after selection) have shorter names; skipped.
    """
    for est in _walk_estimators(model):
        fni = getattr(est, "feature_names_in_", None)
        if fni is not None and len(fni):
            return [str(x) for x in fni]
    return []


def _find_column_transformer(est: Any, depth: int = 0):
    if depth > 12:
        return None
    try:
        from sklearn.compose import ColumnTransformer
    except ImportError:
        return None

    if isinstance(est, ColumnTransformer):
        return est
    if hasattr(est, "named_steps"):
        for step in est.named_steps.values():
            found = _find_column_transformer(step, depth + 1)
            if found is not None:
                return found
    if hasattr(est, "estimators_"):
        for sub in getattr(est, "estimators_", []) or []:
            found = _find_column_transformer(sub, depth + 1)
            if found is not None:
                return found
    return None


def infer_numeric_and_categorical_sets(model: Any) -> tuple[set[str], set[str]]:
    """From fitted ColumnTransformer blocks 'num' / 'cat' (dev2 layout)."""
    numeric: set[str] = set()
    categorical: set[str] = set()
    ct = _find_column_transformer(model)
    if ct is None:
        return numeric, categorical

    for name, _, cols in getattr(ct, "transformers_", []) or []:
        if cols == "drop":
            continue
        if isinstance(cols, str) and cols in ("remainder", "passthrough"):
            continue
        if not hasattr(cols, "__iter__") or isinstance(cols, str):
            continue
        col_list = [str(c) for c in cols]
        if name == "num":
            numeric.update(col_list)
        elif name == "cat":
            categorical.update(col_list)
        else:
            categorical.update(col_list)

    return numeric, categorical


def merge_kind_hints(
    columns: list[str],
    numeric_set: set[str],
    categorical_set: set[str],
    meta_kinds: dict[str, str] | None,
) -> dict[str, str]:
    meta_kinds = meta_kinds or {}
    out: dict[str, str] = {}
    for c in columns:
        if c in numeric_set:
            out[c] = "number"
        elif c in categorical_set:
            out[c] = "text"
        elif c in meta_kinds:
            out[c] = meta_kinds[c]
        else:
            out[c] = "text"
    return out


def coerce_row_values(
    raw_list: list[str],
    columns: list[str],
    kinds: dict[str, str],
) -> list[Any]:
    """
    One value per column position (handles duplicate column names in schema).
    Order matches `columns` exactly.
    """
    out: list[Any] = []
    for idx, c in enumerate(columns):
        v = raw_list[idx] if idx < len(raw_list) else ""
        kind = kinds.get(c, "text")
        if kind == "number":
            if v is None or (isinstance(v, str) and not str(v).strip()):
                out.append(np.nan)
            else:
                num = pd.to_numeric(v, errors="coerce")
                out.append(float(num) if pd.notna(num) else np.nan)
        else:
            if v is None:
                out.append("")
            else:
                out.append(str(v).strip())
    return out


def build_prediction_frame(values: list[Any], columns: list[str]) -> pd.DataFrame:
    return pd.DataFrame([values], columns=columns)
