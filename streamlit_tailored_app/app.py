"""
Prediction-only UI for a completed AutoML run.

Loads model paths from runtime/active_context.json (updated every time you click
“Run Streamlit” in DataPilot). OS environment variables are frozen when Streamlit
starts, so we MUST read this file on each run — then switching datasets updates
inputs automatically without restarting the backend or Streamlit process.
"""
from __future__ import annotations

import hashlib
import json
import os
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st

from predict_helpers import (
    build_prediction_frame,
    coerce_row_values,
    infer_expected_columns,
    infer_numeric_and_categorical_sets,
    merge_kind_hints,
)

st.set_page_config(page_title="DataPilot · Predict", layout="wide")

_APP_DIR = Path(__file__).resolve().parent
_ACTIVE_CTX = _APP_DIR / "runtime" / "active_context.json"


def _bump_context_if_stale() -> None:
    """DataPilot rewrites active_context.json when you start Streamlit for another run — detect mtime and reset UI."""
    if not _ACTIVE_CTX.is_file():
        return
    try:
        cur_mtime = os.path.getmtime(_ACTIVE_CTX)
    except OSError:
        return
    prev = st.session_state.get("_ctx_file_mtime")
    if prev is not None and cur_mtime != prev:
        st.cache_resource.clear()
        st.session_state.clear()
        st.session_state["_ctx_file_mtime"] = cur_mtime
        st.rerun()
    st.session_state["_ctx_file_mtime"] = cur_mtime


_bump_context_if_stale()


def _ensure_import_path_for_model(project_root: str) -> None:
    root = (project_root or "").strip() or os.environ.get("AUTOML_PROJECT_ROOT", "").strip()
    if root and root not in sys.path:
        sys.path.insert(0, root)


def _resolve_paths() -> tuple[str, str, str, str]:
    """
    Returns model_path, meta_path, project_root, context_updated_at_iso.
    Prefer active_context.json (updated on every Run Streamlit click); env is fallback.
    """
    if _ACTIVE_CTX.is_file():
        try:
            raw = json.loads(_ACTIVE_CTX.read_text(encoding="utf-8"))
            mp = (raw.get("modelPath") or raw.get("model_path") or "").strip()
            mt = (raw.get("metaPath") or raw.get("meta_path") or "").strip()
            pr = (raw.get("projectRoot") or raw.get("project_root") or "").strip()
            ts = str(raw.get("updatedAt") or "")
            if mp and mt and Path(mp).is_file() and Path(mt).is_file():
                return mp, mt, pr, ts
        except (OSError, json.JSONDecodeError, TypeError):
            pass

    mp = os.environ.get("AUTOML_STREAMLIT_MODEL_PATH", "").strip()
    mt = os.environ.get("AUTOML_STREAMLIT_META_PATH", "").strip()
    pr = os.environ.get("AUTOML_PROJECT_ROOT", "").strip()
    return mp, mt, pr, ""


@st.cache_resource
def _load_pickled_model(normalized_model_path: str, file_mtime: float) -> object:
    """Cache busts when path or file contents change (mtime)."""
    with open(normalized_model_path, "rb") as f:
        return pickle.load(f)


def _load_session_model_meta():
    model_path, meta_path, project_root, ctx_ts = _resolve_paths()
    if not model_path or not meta_path:
        return None, None, None, None, "Use DataPilot → Run → Downloads → “Run Streamlit app” (missing paths)."
    npath = os.path.normpath(model_path)
    if not Path(npath).is_file():
        return None, None, None, None, f"Model file not found: {npath}"
    if not Path(meta_path).is_file():
        return None, None, None, None, f"Metadata file not found: {meta_path}"

    try:
        mtime = os.path.getmtime(npath)
    except OSError:
        mtime = 0.0

    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    _ensure_import_path_for_model(project_root)
    if project_root:
        os.environ["AUTOML_PROJECT_ROOT"] = project_root

    model = _load_pickled_model(npath, mtime)
    return model, meta, npath, ctx_ts, None


model, meta, model_path, ctx_updated_at, err = _load_session_model_meta()

if err:
    st.title("DataPilot · Streamlit")
    st.error(err)
    if _ACTIVE_CTX.is_file():
        st.caption(f"Config file: `{_ACTIVE_CTX}` — trigger it again from DataPilot after training completes.")
    st.stop()

run_id = str(meta.get("runId", "unknown"))

expected_columns = infer_expected_columns(model)
meta_columns = [str(c) for c in (meta.get("featureColumns") or [])]

if not expected_columns:
    expected_columns = meta_columns

if not expected_columns:
    st.error(
        "Could not determine feature columns from the model. "
        "Ensure training used a pandas DataFrame and a recent scikit-learn (feature_names_in_)."
    )
    st.stop()

# Switching dataset/run → new meta + model path + columns → wipe widgets
_session_key = hashlib.sha256(
    f"{run_id}|{model_path}|{ctx_updated_at}|{chr(1).join(expected_columns)}".encode("utf-8", errors="replace")
).hexdigest()
if st.session_state.get("_datapilot_session") != _session_key:
    ctx_mt_preserved = st.session_state.get("_ctx_file_mtime")
    st.session_state.clear()
    if ctx_mt_preserved is not None:
        st.session_state["_ctx_file_mtime"] = ctx_mt_preserved
    elif _ACTIVE_CTX.is_file():
        try:
            st.session_state["_ctx_file_mtime"] = os.path.getmtime(_ACTIVE_CTX)
        except OSError:
            pass
    st.session_state["_datapilot_session"] = _session_key

_key_ns = hashlib.md5(
    f"{run_id}|{model_path}|{ctx_updated_at}".encode("utf-8", errors="replace")
).hexdigest()[:14]

num_set, cat_set = infer_numeric_and_categorical_sets(model)
meta_kinds = meta.get("featureKinds") or {}
kinds = merge_kind_hints(expected_columns, num_set, cat_set, meta_kinds)

problem_type = str(meta.get("problemType") or "classification")
target_name = str(meta.get("targetCol") or "target")

st.title("Predict with your trained model")
st.caption(
    f"Run **{run_id[:8]}…** · **{meta.get('runName', 'Run')}** · `{meta.get('datasetFilename', '')}` · "
    f"target **{target_name}** ({problem_type}) · **{meta.get('finalModelLabel', '')}** · "
    f"**{len(expected_columns)}** features · "
    f"context `{ctx_updated_at[:19] if ctx_updated_at else '—'}…`"
)

meta_set, model_set = set(meta_columns), set(expected_columns)
if meta_columns and (meta_set != model_set or meta_columns != expected_columns):
    with st.expander("Metadata vs model (prediction uses the model)", expanded=False):
        st.write("Fields follow **`feature_names_in_`** from the pickle loaded via **active_context.json**.")
        only_model = model_set - meta_set
        only_meta = meta_set - model_set
        if only_model:
            st.caption("Required by model, not in stored meta:")
            st.code(", ".join(sorted(only_model)))
        if only_meta:
            st.caption("In meta but dropped before training:")
            st.code(", ".join(sorted(only_meta)))

if meta.get("metricsSummary"):
    with st.expander("Final metrics (from training)", expanded=False):
        st.json(meta["metricsSummary"])

st.divider()
st.subheader("Feature inputs")
st.write(
    "**Numeric:** number or leave empty for missing (imputer). "
    "**Text:** category/value. When you start Streamlit for another run in DataPilot, this page refreshes and resets."
)

ncols = min(3, max(1, len(expected_columns)))

with st.form("prediction_form"):
    raw_list: list[str] = []
    for row_start in range(0, len(expected_columns), ncols):
        row_cols = st.columns(ncols)
        chunk = expected_columns[row_start : row_start + ncols]
        for j, col in enumerate(chunk):
            i = row_start + j
            kind = kinds.get(col, "text")
            wkey = f"v_{_key_ns}_{i}"
            with row_cols[j]:
                label = f"{col} ({'number' if kind == 'number' else 'text'})"
                raw_list.append(
                    st.text_input(
                        label,
                        value="",
                        placeholder="number or leave empty" if kind == "number" else "",
                        key=wkey,
                    )
                )

    submitted = st.form_submit_button("Predict", type="primary")

if submitted:
    if len(raw_list) != len(expected_columns):
        st.error("Input count mismatch — try refreshing the page.")
    else:
        row_values = coerce_row_values(raw_list, expected_columns, kinds)
        x_df = build_prediction_frame(row_values, expected_columns)
        try:
            pred = model.predict(x_df)
            out = pred[0] if hasattr(pred, "__getitem__") else pred
            st.success("Prediction")
            st.metric(label=f"Predicted {target_name}", value=out)
            if problem_type == "classification" and hasattr(model, "predict_proba"):
                try:
                    proba = model.predict_proba(x_df)
                    st.write("Class probabilities:", np.round(proba[0], 4).tolist())
                except Exception:
                    pass
        except Exception as e:
            st.error(f"Prediction failed: {e}")
            with st.expander("Debug: row sent to model"):
                st.dataframe(x_df, use_container_width=True)
                st.text("dtypes:")
                st.code(x_df.dtypes.to_string())

st.divider()
st.caption("Paths come from `runtime/active_context.json` (updated on every “Run Streamlit” click) — not from frozen env vars.")
