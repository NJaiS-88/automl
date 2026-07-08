"""
Wide-table handling: variance / correlation pruning; frequency encoding for high-cardinality cats.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# Correlation threshold for feature clustering (vs 0.985 used for near-duplicate dropping)
FEATURE_CLUSTER_CORR_THRESHOLD = 0.85


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


def _cluster_features_by_correlation(
    X: pd.DataFrame,
    cols: List[str],
    max_features: Optional[int] = None,
) -> List[str]:
    """Cluster numeric features by absolute Pearson correlation.

    Greedy algorithm: picks the highest-variance unassigned feature as a
    cluster center, groups all features with |corr| > 0.85 into its
    cluster, then returns one representative (highest variance) per cluster.

    When *max_features* is set, large clusters (size > 3) receive one
    protected slot each; remaining slots are filled by peak cluster
    variance across all remaining clusters.
    """
    if len(cols) < 3:
        return cols

    sub = X[cols].apply(pd.to_numeric, errors="coerce")
    corr = sub.corr().abs()

    variances = {}
    for c in cols:
        s = pd.to_numeric(X[c], errors="coerce")
        variances[c] = float(np.nanvar(s.to_numpy(dtype=float)))

    remaining = set(cols)
    clusters: List[List[str]] = []

    while remaining:
        center = max(remaining, key=lambda c: variances.get(c, 0.0))
        members = [center]
        remaining.remove(center)
        to_remove = [c for c in remaining if corr.loc[center, c] > FEATURE_CLUSTER_CORR_THRESHOLD]
        members.extend(to_remove)
        for c in to_remove:
            remaining.remove(c)
        clusters.append(members)

    # One rep per cluster (highest variance within cluster)
    reps = [max(cl, key=lambda c: variances.get(c, 0.0)) for cl in clusters]

    if max_features is not None and len(reps) > max_features:
        # Protected slots for clusters with >3 members (high redundancy)
        protected = [(cl, rep) for cl, rep in zip(clusters, reps) if len(cl) > 3]
        remaining_clusters = [(cl, rep) for cl, rep in zip(clusters, reps) if len(cl) <= 3]

        protected_reps = [rep for _, rep in protected]
        remaining_needed = max_features - len(protected_reps)

        if remaining_needed <= 0:
            # Protected slots already fill the cap; keep the highest-variance ones
            protected.sort(key=lambda t: max(variances.get(c, 0.0) for c in t[0]), reverse=True)
            return [rep for _, rep in protected[:max_features]]

        # Remaining slots filled by peak cluster variance
        remaining_clusters.sort(
            key=lambda t: max(variances.get(c, 0.0) for c in t[0]), reverse=True
        )
        return protected_reps + [rep for _, rep in remaining_clusters[:remaining_needed]]

    return reps


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

            # Phase 1 — cluster correlated numerics and keep one rep per cluster
            if len(nc) > 100 and keep_k < len(nc):
                nc_before = len(nc)
                nc = _cluster_features_by_correlation(Xw, nc, max_features=keep_k)
                dropped_cluster = nc_before - len(nc)
            else:
                dropped_cluster = 0

            cc = [c for c in cc if c in Xw.columns]
            while len(nc) + len(cc) > int(cap) and len(cc) > 1:
                cc = cc[:-1]
            extras = [c for c in Xw.columns if c not in nc and c not in cc and c not in (y.name if hasattr(y, "name") and y.name is not None else [])]
            if extras:
                Xw = Xw.drop(columns=extras, errors="ignore")
        report["capped_columns"] = True
        if dropped_cluster:
            report["clustered_features"] = dropped_cluster

    num_out = [c for c in nc if c in Xw.columns]
    cat_out = [c for c in cat_cols if c in Xw.columns]
    return Xw, num_out, cat_out, report
