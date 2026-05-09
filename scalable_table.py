"""
Wide-table handling: variance / correlation pruning; frequency encoding for high-cardinality cats.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd


def apply_frequency_encoding(
    X: pd.DataFrame, cat_cols: List[str]
) -> Tuple[pd.DataFrame, List[str], List[str], List[str]]:
    """Replace categorical columns with per-row frequency of their category (numeric)."""
    if not cat_cols:
        return X, list(X.select_dtypes(include=[np.number]).columns), [], []
    Xn = X.copy()
    encoded: List[str] = []
    for c in cat_cols:
        if c not in Xn.columns:
            continue
        vc = Xn[c].astype(str).value_counts(normalize=True)
        Xn[f"{c}__freq"] = Xn[c].astype(str).map(vc).astype("float64")
        Xn = Xn.drop(columns=[c])
        encoded.append(c)
    num_cols = list(Xn.select_dtypes(include=[np.number]).columns)
    cat_cols_out = [c for c in Xn.columns if c not in num_cols]
    return Xn, num_cols, cat_cols_out, encoded


def compress_wide_features(
    X: pd.DataFrame,
    y: pd.Series,
    num_cols: List[str],
    cat_cols: List[str],
    strategy: Any,
) -> Tuple[pd.DataFrame, List[str], List[str], Dict[str, Any]]:
    """Drop near-constant numerics and redundant highly-correlated numerics."""
    report: Dict[str, Any] = {
        "dropped_low_variance": [],
        "dropped_correlated": [],
        "capped_columns": False,
    }
    if not getattr(strategy, "apply_wide_table_filters", False):
        return X, num_cols, cat_cols, report

    Xw = X.copy()
    nc = [c for c in num_cols if c in Xw.columns]
    thr = float(getattr(strategy, "variance_drop_ratio", 1e-8))

    drop_v: List[str] = []
    for c in nc:
        s = pd.to_numeric(Xw[c], errors="coerce")
        if s.nunique(dropna=True) <= 1:
            drop_v.append(c)
            continue
        v = np.nanvar(s.to_numpy(dtype=float), ddof=0)
        if (not np.isfinite(v)) or v <= thr:
            drop_v.append(c)
    if drop_v:
        Xw = Xw.drop(columns=drop_v, errors="ignore")
        report["dropped_low_variance"] = drop_v
    nc = [c for c in nc if c not in drop_v]

    if len(nc) >= 2:
        cth = float(getattr(strategy, "corr_drop_threshold", 0.985))
        use_cols = nc
        if len(nc) > 180:
            variances = []
            for c in nc:
                s = pd.to_numeric(Xw[c], errors="coerce")
                variances.append((c, float(np.nanvar(s.to_numpy(dtype=float)))))
            variances.sort(key=lambda t: t[1], reverse=True)
            use_cols = [t[0] for t in variances[:120]]

        sub = Xw[use_cols].apply(pd.to_numeric, errors="coerce")
        corr = sub.corr().abs()
        drop_c: set[str] = set()
        cols = list(corr.columns)
        for i in range(len(cols)):
            for j in range(i + 1, len(cols)):
                if corr.iloc[i, j] > cth:
                    drop_c.add(cols[j])
        if drop_c:
            Xw = Xw.drop(columns=list(drop_c), errors="ignore")
            report["dropped_correlated"] = sorted(drop_c)
        nc = [c for c in nc if c in Xw.columns]

    cap = getattr(strategy, "max_total_features_after_compress", None)
    cc = [c for c in cat_cols if c in Xw.columns]
    if cap is not None and len(nc) + len(cc) > int(cap):
        if len(nc) + len(cc) > 0:
            keep_k = max(1, int(cap) - min(len(cc), max(1, int(cap) // 4)))
            variances = []
            for c in nc:
                s = pd.to_numeric(Xw[c], errors="coerce")
                variances.append((c, float(np.nanvar(s.to_numpy(dtype=float)))))
            variances.sort(key=lambda t: t[1], reverse=True)
            keep_n = {t[0] for t in variances[: min(keep_k, len(variances))]}
            drop_n = [c for c in nc if c not in keep_n]
            if drop_n:
                Xw = Xw.drop(columns=drop_n, errors="ignore")
            nc = [c for c in nc if c in Xw.columns]
            cc = [c for c in cc if c in Xw.columns]
            while len(nc) + len(cc) > int(cap) and len(cc) > 1:
                cc = cc[:-1]
            extras = [c for c in Xw.columns if c not in nc and c not in cc and c not in (y.name if hasattr(y, "name") else [])]
            if extras:
                Xw = Xw.drop(columns=extras, errors="ignore")
        report["capped_columns"] = True

    num_out = [c for c in nc if c in Xw.columns]
    cat_out = [c for c in cat_cols if c in Xw.columns]
    return Xw, num_out, cat_out, report
