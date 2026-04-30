# AutoML Project (Dev1 + Dev2 + Dev3)

This repository now runs all three developer stages in order:

1. `dev1_data_pipeline.py` - Data validation/cleaning + end-to-end orchestration
2. `dev2_automl_doctor.py` - AutoML model training and model selection
3. `dev3_auto_optimization.py` - Post-training diagnosis and automatic optimization

The main entry point for full execution is `dev1_data_pipeline.py`.

## Project architecture

### Dev1: Data pipeline + orchestrator (`dev1_data_pipeline.py`)
- Validates that target column exists
- Cleans input data:
  - drops rows with missing target values
  - drops duplicate rows
- Calls Dev2 training flow
- Sends trained Dev2 pipeline to Dev3 optimizer
- Generates a final JSON report containing:
  - data cleaning report
  - Dev2 ranking and baseline metrics
  - Dev3 optimization decisions and final metrics

### Dev2: Base AutoML engine (`dev2_automl_doctor.py`)
- Infers problem type (`classification` or `regression`)
- Builds preprocessing:
  - numeric imputation + scaling
  - categorical imputation + one-hot encoding
- Applies feature selection (`SelectKBest`)
- Adds optional feature engineering (`PCA` or polynomial features based on dimensionality)
- Selects candidate models based on data size/task type
- Runs cross-validation scoring
- Picks top model family (single model or stacking ensemble)
- Trains final pipeline
- Produces baseline evaluation metrics

### Dev3: Optimization engine (`dev3_auto_optimization.py`)
- Evaluates train/test performance
- Detects quality issue:
  - `overfitting`
  - `underfitting`
  - `good`
- Detects class imbalance for classification tasks
- Builds tuned candidate estimators dynamically
- Retrains candidates while preserving Dev2 pipeline structure
- Chooses improved model only if it beats original test performance
- Returns before/after/final comparison details

## Installation

Use Python 3.9+ recommended.

```bash
pip install numpy pandas scikit-learn
```

## How to run (full integrated flow)

From project root, run:

```bash
python dev1_data_pipeline.py --file-path "your_dataset.csv" --target-col "target_column_name"
```

Optional arguments:

```bash
python dev1_data_pipeline.py \
  --file-path "your_dataset.csv" \
  --target-col "target_column_name" \
  --output-json "pipeline_report.json" \
  --random-state 42
```

## Required input format

Your input is a CSV file.

Mandatory:
- CSV must contain header row (column names)
- Target column passed in `--target-col` must exist

Recommended:
- One row per sample
- Features can be mixed numeric/categorical
- Target column should not be mostly empty

Example CSV:

```csv
age,income,city,bought
25,45000,Delhi,0
32,72000,Mumbai,1
29,54000,Bangalore,0
```

Run command for this example:

```bash
python dev1_data_pipeline.py --file-path "customer_data.csv" --target-col "bought"
```

## Console output you will see

During execution:
- `STAGE 1/3 - DEV1 DATA PIPELINE`
- `STAGE 2/3 - DEV2 AUTO ML DOCTOR`
- per-model CV scores from Dev2
- `STAGE 3/3 - DEV3 AUTO OPTIMIZATION`
- issue detected by Dev3 and selected model version
- final completion message

Typical ending:

```text
PIPELINE COMPLETED
Report saved to: C:\...\pipeline_report.json
Final metrics: {...}
```

## Output file details

Default output file: `pipeline_report.json` (can be changed via `--output-json`).

Report contains these top-level sections:
- `data_report` (Dev1)
- `problem_type`
- `dev2`
- `dev3`

High-value fields:
- `data_report.rows_after_cleaning`
- `dev2.ranked_models`
- `dev2.baseline_metrics`
- `dev3.issue_detected`
- `dev3.selected_model_version`
- `dev3.best_candidate_name`
- `dev3.final_metrics`

## Understanding metrics

### Classification
You may see:
- `train_acc`, `test_acc`
- `f1`, `precision`, `recall`
- `roc_auc` (if probabilities are available)

### Regression
You may see:
- `train_r2`, `test_r2`
- `mae`
- `rmse`

## Troubleshooting

### Target column not found
Error:
- `Target column '...' not found`

Fix:
- check CSV headers and exact `--target-col` spelling

### Dataset becomes empty after cleaning
Error:
- `Dataset is empty after removing rows with missing target/duplicates.`

Fix:
- ensure target has valid values
- verify CSV is not duplicated/blank

### Runtime is slow
Cause:
- cross-validation over multiple model candidates

Fix:
- reduce dataset size for quick tests
- later customize folds/model list in Dev2 if needed

## File-by-file API entry points

- Dev1 integrated runner:
  - `run_full_pipeline(file_path, target_col, random_state=42)`
- Dev2 base runner:
  - `run_automl(file_path, target_col)`
- Dev3 optimizer:
  - `optimize_model(model, X_train, X_test, y_train, y_test, problem_type)`

## Recommended workflow

1. Prepare CSV + decide target column.
2. Run integrated command from Dev1.
3. Open `pipeline_report.json`.
4. Compare Dev2 baseline vs Dev3 final metrics.
5. If needed, iterate with improved data/features.

## Web App (MERN) Run Guide

This project now includes a web app:

- `backend/` (Express + MongoDB + JWT auth + Python bridge)
- `frontend/` (React + Zustand + responsive dashboard)

### Backend env

Create `backend/.env`:

```env
PORT=4000
MONGODB_URI=<your_mongodb_uri>
CLIENT_URL=http://localhost:5173
PROJECT_ROOT=C:/New folder (6)
JWT_SECRET=<strong_secret_here>
```

### Local start

Backend:

```bash
cd backend
npm install
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open: `http://localhost:5173`

## Deployment Notes

### Backend (production)

```bash
cd backend
npm install --omit=dev
npm start
```

Set env vars in your host:
- `MONGODB_URI`
- `JWT_SECRET`
- `CLIENT_URL`
- `PROJECT_ROOT`
- `PORT`
- Install Python deps for pipeline bridge:
  - `pip install -r backend/requirements.txt`

### Frontend (production)

```bash
cd frontend
npm install
npm run build
npm run preview
```

Deploy `frontend/dist` on static hosting (Vercel/Netlify/etc), and point API base URL to deployed backend.

## Vercel + Render (Recommended)

### 1) Deploy backend to Render

- Use `backend/` as root directory.
- Build command:
  - `npm install && pip install -r requirements.txt`
- Start command:
  - `npm start`
- Environment variables:
  - `MONGODB_URI`
  - `JWT_SECRET`
  - `PORT=4000`
  - `PROJECT_ROOT=/opt/render/project/src`
  - `CLIENT_URL=https://<your-vercel-domain>`

You can also use provided `render.yaml`.

### 2) Deploy frontend to Vercel

- Framework preset: Vite
- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables:
  - `VITE_API_BASE_URL=https://<your-render-backend>/api`
  - `VITE_BACKEND_BASE_URL=https://<your-render-backend>`

### 3) Update backend CORS

Set backend `CLIENT_URL` to your Vercel URL.
For multiple origins (local + prod), comma-separate:

```env
CLIENT_URL=http://localhost:5173,https://your-app.vercel.app
```

## GitHub Safety (No secrets)

- Root `.gitignore` is configured to exclude:
  - `.env` files
  - `backend/uploads` and `backend/generated`
  - model binaries (`*.pkl`, `*.joblib`)
  - local reports and temporary artifacts
- Commit only:
  - `backend/.env.example` (safe template)
  - source code and docs

If `.env` was ever committed before, rotate keys immediately and remove it from git history.

