import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns


def _is_numeric(series):
    return pd.api.types.is_numeric_dtype(series)


def _save_current_fig(output_dir: Path, counter: dict, title: str):
    counter["value"] += 1
    safe_title = "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in title.lower())
    out = output_dir / f"{counter['value']:03d}_{safe_title}.png"
    plt.tight_layout()
    plt.savefig(out, dpi=140, bbox_inches="tight")
    plt.close()
    return str(out)


def _plot_univariate(df, col, hue, plot_type, output_dir, counter):
    if col not in df.columns:
        return None
    s = df[col]
    numeric = _is_numeric(s)

    if plot_type == "histogram" and numeric:
        plt.figure(figsize=(8, 5))
        sns.histplot(data=df, x=col, hue=hue if hue in df.columns and hue != col else None, kde=False)
        return _save_current_fig(output_dir, counter, f"histogram_{col}")

    if plot_type == "kde" and numeric:
        plt.figure(figsize=(8, 5))
        sns.kdeplot(data=df, x=col, hue=hue if hue in df.columns and hue != col else None, fill=True, common_norm=False)
        return _save_current_fig(output_dir, counter, f"kde_{col}")

    if plot_type == "violin":
        plt.figure(figsize=(8, 5))
        if hue in df.columns and hue != col:
            if numeric:
                sns.violinplot(data=df, x=hue, y=col)
            else:
                sns.violinplot(data=df, x=col, y=hue)
        elif numeric:
            sns.violinplot(data=df, x=col)
        else:
            return None
        return _save_current_fig(output_dir, counter, f"violin_{col}")

    if plot_type == "box":
        plt.figure(figsize=(8, 5))
        if hue in df.columns and hue != col:
            if numeric:
                sns.boxplot(data=df, x=hue, y=col)
            else:
                sns.boxplot(data=df, x=col, y=hue)
        elif numeric:
            sns.boxplot(data=df, x=col)
        else:
            return None
        return _save_current_fig(output_dir, counter, f"box_{col}")

    if plot_type == "line" and numeric:
        plt.figure(figsize=(8, 5))
        tmp = df[[col]].copy().dropna().reset_index(drop=True)
        tmp["row_index"] = tmp.index + 1
        sns.lineplot(data=tmp, x="row_index", y=col)
        return _save_current_fig(output_dir, counter, f"line_{col}")

    if plot_type == "bar":
        plt.figure(figsize=(8, 5))
        vc = s.astype(str).value_counts(dropna=False).head(25)
        sns.barplot(x=vc.index, y=vc.values)
        plt.xticks(rotation=45, ha="right")
        plt.xlabel(col)
        plt.ylabel("count")
        return _save_current_fig(output_dir, counter, f"bar_{col}")

    if plot_type == "pie":
        vc = s.astype(str).value_counts(dropna=False).head(12)
        if vc.empty:
            return None
        plt.figure(figsize=(7, 7))
        plt.pie(vc.values, labels=vc.index, autopct="%1.1f%%")
        plt.title(f"Pie Chart - {col}")
        return _save_current_fig(output_dir, counter, f"pie_{col}")

    return None


def _plot_bivariate(df, x_col, y_col, hue, plot_type, output_dir, counter):
    if x_col not in df.columns or y_col not in df.columns:
        return None
    x_num = _is_numeric(df[x_col])
    y_num = _is_numeric(df[y_col])
    hue_col = hue if hue in df.columns and hue not in (x_col, y_col) else None

    if plot_type == "scatter" and x_num and y_num:
        plt.figure(figsize=(8, 5))
        sns.scatterplot(data=df, x=x_col, y=y_col, hue=hue_col, alpha=0.7)
        return _save_current_fig(output_dir, counter, f"scatter_{x_col}_{y_col}")

    if plot_type == "line" and x_num and y_num:
        plt.figure(figsize=(8, 5))
        tmp = df[[x_col, y_col] + ([hue_col] if hue_col else [])].dropna().sort_values(by=x_col)
        sns.lineplot(data=tmp, x=x_col, y=y_col, hue=hue_col)
        return _save_current_fig(output_dir, counter, f"line_{x_col}_{y_col}")

    if plot_type == "box":
        if not (x_num and y_num):
            plt.figure(figsize=(8, 5))
            sns.boxplot(data=df, x=x_col, y=y_col, hue=hue_col)
            return _save_current_fig(output_dir, counter, f"box_{x_col}_{y_col}")
        return None

    if plot_type == "violin":
        if not (x_num and y_num):
            plt.figure(figsize=(8, 5))
            sns.violinplot(data=df, x=x_col, y=y_col, hue=hue_col)
            return _save_current_fig(output_dir, counter, f"violin_{x_col}_{y_col}")
        return None

    if plot_type == "bar":
        plt.figure(figsize=(8, 5))
        sns.barplot(data=df, x=x_col, y=y_col, hue=hue_col)
        return _save_current_fig(output_dir, counter, f"bar_{x_col}_{y_col}")

    if plot_type == "kde" and x_num and y_num:
        plt.figure(figsize=(8, 5))
        sns.kdeplot(data=df, x=x_col, y=y_col, hue=hue_col, fill=True)
        return _save_current_fig(output_dir, counter, f"kde_{x_col}_{y_col}")

    if plot_type == "histogram" and x_num:
        plt.figure(figsize=(8, 5))
        sns.histplot(data=df, x=x_col, hue=hue_col, kde=False)
        return _save_current_fig(output_dir, counter, f"histogram_{x_col}")

    return None


def _plot_multivariate(df, cols, hue, plot_type, output_dir, counter):
    valid_cols = [c for c in cols if c in df.columns]
    if plot_type == "correlation_heatmap":
        num_cols = [c for c in valid_cols if _is_numeric(df[c])]
        if len(num_cols) < 2:
            return None
        plt.figure(figsize=(10, 8))
        sns.heatmap(df[num_cols].corr(), annot=True, cmap="coolwarm", fmt=".2f")
        plt.title("Correlation Heatmap")
        return _save_current_fig(output_dir, counter, "correlation_heatmap")

    if plot_type == "pairplot":
        num_cols = [c for c in valid_cols if _is_numeric(df[c])]
        if len(num_cols) < 2:
            return None
        sample_df = df[num_cols + ([hue] if hue in df.columns and hue not in num_cols else [])].dropna()
        if len(sample_df) > 1500:
            sample_df = sample_df.sample(1500, random_state=42)
        g = sns.pairplot(sample_df, hue=hue if hue in sample_df.columns else None)
        out = _save_current_fig(output_dir, counter, "pairplot")
        plt.close(g.fig)
        return out

    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-path", required=True)
    parser.add_argument("--payload-path", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.payload_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    df = pd.read_csv(args.dataset_path)
    df.columns = [c.strip() for c in df.columns]

    mode = payload.get("mode", "univariate")
    plot_types = payload.get("plotTypes", [])
    x_col = payload.get("xCol")
    y_col = payload.get("yCol")
    single_col = payload.get("singleCol")
    hue = payload.get("hueCol")
    multivariate_cols = payload.get("multivariateCols", list(df.columns))

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    counter = {"value": 0}
    plot_paths = []
    errors = []

    for plot_type in plot_types:
        try:
            out = None
            if mode == "univariate":
                out = _plot_univariate(df, single_col, hue, plot_type, output_dir, counter)
            elif mode == "bivariate":
                out = _plot_bivariate(df, x_col, y_col, hue, plot_type, output_dir, counter)
            elif mode == "multivariate":
                out = _plot_multivariate(df, multivariate_cols, hue, plot_type, output_dir, counter)
            if out:
                plot_paths.append(out)
        except Exception as exc:
            errors.append(f"{plot_type}: {str(exc)}")
            plt.close("all")

    print(json.dumps({"plot_paths": plot_paths, "errors": errors}))


if __name__ == "__main__":
    main()
