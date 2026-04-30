# ============================================
# 🔥 SMART DATA ANALYSIS + VISUALIZATION ENGINE
# ============================================

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import argparse

import warnings
warnings.filterwarnings("ignore")

MAX_BIVARIATE_NUM_NUM = 12
MAX_BIVARIATE_CAT_NUM = 12
MAX_BIVARIATE_CAT_CAT = 6
SAMPLE_ROWS_FOR_PLOTS = 5000
MAX_HUE_CLASSES = 12


# ============================================
# 📦 LOAD DATA
# ============================================

def load_data(file_path):
    df = pd.read_csv(file_path)
    df.columns = [c.strip() for c in df.columns]
    print("Data Loaded Successfully\n")
    return df


def _resolve_target_column(df, target_col):
    if not target_col:
        return None
    if target_col in df.columns:
        return target_col
    normalized = target_col.strip().lower()
    matches = [c for c in df.columns if c.strip().lower() == normalized]
    if len(matches) == 1:
        return matches[0]
    common_target_aliases = {"target", "label", "class", "species", "churn", "outcome", "y"}
    if normalized in common_target_aliases and len(df.columns) > 1:
        fallback_col = df.columns[-1]
        print(
            f"Warning: Target '{target_col}' not found; using last column '{fallback_col}' as fallback target."
        )
        return fallback_col
    raise ValueError(f"Target column '{target_col}' not found. Available columns: {list(df.columns)}")


def _is_binary_series(series):
    non_null = series.dropna()
    if non_null.empty:
        return False
    unique_vals = set(non_null.unique().tolist())
    if len(unique_vals) != 2:
        return False
    normalized = {str(v).strip().lower() for v in unique_vals}
    binary_tokens = {
        "0", "1", "yes", "no", "true", "false", "y", "n", "t", "f",
        "male", "female"
    }
    return normalized.issubset(binary_tokens) or pd.api.types.is_bool_dtype(series)


def _is_probable_id_column(df, col):
    s = df[col]
    non_null = s.dropna()
    if non_null.empty:
        return False
    # Drop as ID only when every non-null value is unique after cleaning.
    return non_null.nunique() == len(non_null)


def _select_plot_columns(df, num_cols, cat_cols, target_col=None):
    id_cols = [c for c in df.columns if _is_probable_id_column(df, c)]
    num_cols = [c for c in num_cols if c not in id_cols]
    cat_cols = [c for c in cat_cols if c not in id_cols]

    binary_cols = [c for c in df.columns if c not in id_cols and _is_binary_series(df[c])]
    non_binary_num = [c for c in num_cols if c not in binary_cols]
    non_binary_cat = [c for c in cat_cols if c not in binary_cols]

    # Prioritize richer columns for plotting.
    non_binary_num = sorted(non_binary_num, key=lambda c: df[c].nunique(dropna=True), reverse=True)
    non_binary_cat = sorted(non_binary_cat, key=lambda c: df[c].nunique(dropna=True))

    return {
        "id_cols": id_cols,
        "binary_cols": binary_cols,
        "num_cols": non_binary_num,
        "cat_cols": non_binary_cat,
        "all_num_cols": num_cols,
        "all_cat_cols": cat_cols,
        "target_col": target_col,
    }


def _get_hue_column(df, target_col):
    if not target_col or target_col not in df.columns:
        return None
    unique_count = df[target_col].nunique(dropna=True)
    if unique_count <= MAX_HUE_CLASSES:
        return target_col
    return None


# ============================================
# 📊 BASIC ANALYSIS
# ============================================

def basic_analysis(df):
    print("SHAPE:", df.shape)
    print("\nDATA TYPES:\n", df.dtypes)
    
    print("\nMISSING VALUES:\n", df.isnull().sum())
    
    print("\nSTATISTICS:\n", df.describe(include='all'))


# ============================================
# 🔍 COLUMN TYPE DETECTION
# ============================================

def detect_column_types(df):
    num_cols = df.select_dtypes(include=np.number).columns.tolist()
    cat_cols = df.select_dtypes(include=['object', 'category', 'bool']).columns.tolist()
    
    print("\nNumerical Columns:", num_cols)
    print("Categorical Columns:", cat_cols)
    
    return num_cols, cat_cols


# ============================================
# 📊 UNIVARIATE ANALYSIS
# ============================================

def univariate_analysis(df, num_cols, cat_cols, hue_col=None):
    
    print("\nUNIVARIATE ANALYSIS\n")
    
    # 🔹 Numerical
    for col in num_cols:
        fig, axes = plt.subplots(2, 2, figsize=(12, 8))
        fig.suptitle(f"Univariate View: {col}", fontsize=13)

        sns.histplot(df[col], kde=True, ax=axes[0, 0])
        axes[0, 0].set_title("Histogram + KDE")

        if hue_col and hue_col != col:
            sns.kdeplot(data=df, x=col, hue=hue_col, common_norm=False, ax=axes[0, 1])
            axes[0, 1].set_title(f"KDE by {hue_col}")
        else:
            sns.kdeplot(data=df, x=col, ax=axes[0, 1], color="tab:blue")
            axes[0, 1].set_title("KDE")

        sns.boxplot(x=df[col], ax=axes[1, 0])
        axes[1, 0].set_title("Boxplot")

        sns.violinplot(x=df[col], ax=axes[1, 1], inner="quartile")
        axes[1, 1].set_title("Violin")

        plt.tight_layout()
        plt.show()
    
    # 🔹 Categorical
    for col in cat_cols:
        fig, axes = plt.subplots(2, 2, figsize=(12, 8))
        fig.suptitle(f"Univariate View: {col}", fontsize=13)

        value_counts = df[col].value_counts(dropna=False).head(20)
        sns.barplot(x=value_counts.index.astype(str), y=value_counts.values, ax=axes[0, 0])
        axes[0, 0].tick_params(axis="x", rotation=45)
        axes[0, 0].set_title("Top Count Plot")
        axes[0, 0].set_xlabel(col)
        axes[0, 0].set_ylabel("Count")

        sns.countplot(data=df, y=col, order=df[col].value_counts().head(20).index, ax=axes[0, 1])
        axes[0, 1].set_title("Horizontal Count Plot")

        value_counts.plot(kind="pie", autopct="%1.1f%%", ax=axes[1, 0])
        axes[1, 0].set_ylabel("")
        axes[1, 0].set_title("Category Share")

        axes[1, 1].axis("off")
        axes[1, 1].text(
            0.05,
            0.6,
            f"Unique categories: {df[col].nunique(dropna=True)}\nMissing values: {df[col].isna().sum()}",
            fontsize=11,
        )
        axes[1, 1].set_title("Column Summary")

        plt.tight_layout()
        plt.show()


# ============================================
# 📊 BIVARIATE ANALYSIS
# ============================================

def bivariate_analysis(df, num_cols, cat_cols, target=None, hue_col=None):
    
    print("\nBIVARIATE ANALYSIS\n")
    
    # 🔹 Numerical vs Numerical → Scatterplot
    pair_count = 0
    for i in range(len(num_cols)):
        for j in range(i+1, len(num_cols)):
            if pair_count >= MAX_BIVARIATE_NUM_NUM:
                break
            plt.figure(figsize=(6,4))
            if hue_col and hue_col not in (num_cols[i], num_cols[j]):
                sns.scatterplot(data=df, x=num_cols[i], y=num_cols[j], hue=hue_col, alpha=0.7)
                plt.title(f"{num_cols[i]} vs {num_cols[j]} (hue={hue_col})")
            else:
                sns.scatterplot(x=df[num_cols[i]], y=df[num_cols[j]])
                plt.title(f"{num_cols[i]} vs {num_cols[j]}")
            plt.show()
            pair_count += 1
    
    # 🔹 Categorical vs Numerical → Boxplot
    pair_count = 0
    for cat in cat_cols:
        for num in num_cols:
            if pair_count >= MAX_BIVARIATE_CAT_NUM:
                break
            if _is_binary_series(df[cat]) and _is_binary_series(df[num]):
                continue
            plt.figure(figsize=(6,4))
            sns.boxplot(x=df[cat], y=df[num])
            plt.title(f"{cat} vs {num}")
            plt.xticks(rotation=45)
            plt.show()
            pair_count += 1
    
    # 🔹 Categorical vs Categorical → Heatmap (Cross-tab)
    pair_count = 0
    for i in range(len(cat_cols)):
        for j in range(i+1, len(cat_cols)):
            if pair_count >= MAX_BIVARIATE_CAT_CAT:
                break
            if _is_binary_series(df[cat_cols[i]]) and _is_binary_series(df[cat_cols[j]]):
                continue
            ct = pd.crosstab(df[cat_cols[i]], df[cat_cols[j]])
            if ct.shape[0] > 20 or ct.shape[1] > 20:
                continue
            plt.figure(figsize=(6,4))
            sns.heatmap(ct, annot=True, fmt='d', cmap="coolwarm")
            plt.title(f"{cat_cols[i]} vs {cat_cols[j]}")
            plt.show()
            pair_count += 1


# ============================================
# 📊 MULTIVARIATE ANALYSIS
# ============================================

def multivariate_analysis(df, num_cols, target_col=None, hue_col=None):
    
    print("\nMULTIVARIATE ANALYSIS\n")
    
    # 🔹 Correlation Heatmap
    corr_cols = [c for c in num_cols if c != target_col]
    if target_col in num_cols:
        corr_cols = num_cols
    if len(corr_cols) >= 2:
        plt.figure(figsize=(10, 8))
        sns.heatmap(df[corr_cols].corr(), annot=True, cmap="coolwarm")
        plt.title("Correlation Matrix")
        plt.show()


# ============================================
# 📊 TARGET ANALYSIS (IMPORTANT)
# ============================================

def target_analysis(df, target, num_cols, cat_cols, hue_col=None):
    
    print("\nTARGET ANALYSIS\n")
    
    if target in num_cols:
        # Regression target
        for col in num_cols[:MAX_BIVARIATE_CAT_NUM]:
            if col != target:
                plt.figure(figsize=(6,4))
                if hue_col and hue_col not in (col, target):
                    sns.scatterplot(data=df, x=col, y=target, hue=hue_col, alpha=0.7)
                    plt.title(f"{col} vs {target} (hue={hue_col})")
                else:
                    sns.scatterplot(x=df[col], y=df[target])
                    plt.title(f"{col} vs {target}")
                plt.show()
    
    else:
        # Classification target
        for col in num_cols[:MAX_BIVARIATE_CAT_NUM]:
            if _is_binary_series(df[target]) and _is_binary_series(df[col]):
                continue
            plt.figure(figsize=(6,4))
            sns.boxplot(x=df[target], y=df[col])
            plt.title(f"{target} vs {col}")
            plt.show()


# ============================================
# 🚀 MAIN FUNCTION
# ============================================

def run_eda(file_path, target_col=None):
    
    df = load_data(file_path)
    target_col = _resolve_target_column(df, target_col)
    
    basic_analysis(df)
    
    num_cols, cat_cols = detect_column_types(df)
    selected = _select_plot_columns(df, num_cols, cat_cols, target_col=target_col)
    hue_col = _get_hue_column(df, target_col)

    if selected["id_cols"]:
        print(f"\nSkipping ID-like columns: {selected['id_cols']}")
    if selected["binary_cols"]:
        print(f"Binary columns detected: {selected['binary_cols']}")

    # EDA visuals intentionally restricted to only correlation heatmap + pairplot.
    multivariate_analysis(df, selected["num_cols"], target_col=target_col, hue_col=hue_col)
    
    print("\nEDA COMPLETED SUCCESSFULLY! (heatmap only)")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run EDA visualizations for a CSV dataset."
    )
    parser.add_argument("--file-path", required=True, help="Path to input CSV file.")
    parser.add_argument(
        "--target-col",
        default=None,
        help="Optional target column for target-specific visualizations.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    run_eda(args.file_path, args.target_col)


if __name__ == "__main__":
    main()