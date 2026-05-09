"""
Optional float downcasting and light frame compaction for large datasets.
"""
from __future__ import annotations

import pandas as pd

from scalable_strategy import ScalingStrategy


def prepare_frame_memory(X: pd.DataFrame, scaling_strategy: ScalingStrategy) -> pd.DataFrame:
    """
    Return a frame that is safer for RAM on large grids (float64 -> float32 when enabled).
    Always returns a concrete DataFrame (copy when mutated).
    """
    if not getattr(scaling_strategy, "downcast_float", False):
        return X

    out = X.copy()
    float_cols = out.select_dtypes(include=["float64"]).columns
    for c in float_cols:
        out[c] = out[c].astype("float32")
    return out
