# AutoML Platform — Technical Reference (Deep Dive)

This document is the extended, implementation-level companion to the project. It explains how the major code paths, configuration surfaces, and integrations fit together in plain narrative form so engineers can understand the system without jumping between bullet lists and tables.

The main entry points you will touch most often are these. The file `dev1_data_pipeline.py` is the command-line orchestrator: it can optionally run Dev0 for exploratory plots, then runs the full Dev1, Dev2, and Dev3 pipeline, writes a JSON report, and shows interactive matplotlib figures on a desktop Python environment. The file `backend/python/run_pipeline_api.py` is the headless twin used by the MERN stack: it emits progress lines for the Node layer, saves plots with a non-interactive Agg backend, writes artifacts under `generated/`, and can optionally build a chunk-wise ensemble on very large data. Core modeling lives in `dev2_automl_doctor.py` (preprocessing, leakage guard, cross-validated model selection, stacking, and rich evaluation metrics) and `dev3_auto_optimization.py` (post-training diagnosis, candidate search, and optional RandomizedSearchCV on forest estimators). Policy for “how hard to try” given data size is centralized in `scalable_strategy.py`, which materializes a frozen `ScalingStrategy` dataclass consumed by preprocessing, CV, model lists, EDA behavior, and Dev3. The Express application in `backend/src/index.js` wires CORS, serves generated files, mounts auth and runs APIs, and reverse-proxies Streamlit including WebSocket upgrades. The React shell in `frontend/src/App.jsx` provides the authenticated layout, sidebar navigation, theme, and internationalization.

---

## 1. Repository layout (what lives where)

The automl folder is organized so that Python training logic sits at the repository root of that tree, while the web bridge and UI sit in subfolders. At the top level you will find `dev0.py` for the EDA and plotting engine used from the CLI or optionally from the API, `dev1_data_pipeline.py` for the integrated pipeline and its command-line interface with local matplotlib, `dev2_automl_doctor.py` for the sklearn and imbalanced-learn based AutoML core, and `dev3_auto_optimization.py` for the optimization pass after the Dev2 model is fit. The modules `scalable_strategy.py`, `scalable_preprocessing.py`, and `scalable_table.py` implement tiered policies, float downcasting for memory, and wide-table handling including frequency encoding and correlation or variance pruning.

The `backend` folder contains the Node application. Its `package.json` defines the Express server; `requirements.txt` lists Python packages needed for the spawn bridge and for Streamlit-related tooling. Under `backend/python`, `run_pipeline_api.py` is the primary training entry invoked by Node, `predict_api.py` loads a pickled pipeline and scores one row from a JSON payload, `generate_visualizations_api.py` builds on-demand charts for the dashboard, and `chunk_ensemble_model.py` defines a meta-estimator that averages or votes over several fitted models. Under `backend/src`, `index.js` is the HTTP server with CORS, static file serving for `/generated`, health checks, graceful shutdown, and the Streamlit proxy. Configuration modules under `config` cover Mongo connection, upload and generated directory resolution, and the public URL shape for Streamlit. The `middleware/auth.js` file verifies JWT Bearer tokens. Mongoose models `User.js` and `RunHistory.js` persist accounts and training jobs. Routes are split into `auth.js`, `runs.js`, and `streamlit.js`. Services include `pipelineService.js`, which spawns Python and parses progress and final JSON lines, and `csvService.js`, which streams the first thirty rows (by default) of an uploaded CSV for previews. `utils/trainingExport.js` generates downloadable tailored Python scripts and Jupyter notebooks from a completed run.

The `frontend` directory is a Vite plus React application using Zustand for state and react-i18next for locales. The `streamlit_tailored_app` directory holds the prediction-focused Streamlit UI and its `runtime` folder for JSON context that the backend rewrites when the user launches Streamlit from the web app. The `render.yaml` file describes a Render deployment for the backend, and `README.md` stays the concise quick-start. Sample CSV files and artifacts like `my_report.json` are only for local experimentation and are not required at runtime.

---

## 2. End-to-end pipelines (two runners)

### 2.1 CLI path: `dev1_data_pipeline.py`

The `main()` function parses the dataset path, target column name, optional output JSON path, random seed, and a visualization mode that can be `yes`, `no`, or `ask`. When visualization is requested, it loads the CSV, resolves the target column consistently with the rest of the pipeline, and calls `dev0.run_eda` with those paths so the analyst sees plots before training. Regardless of visualization, it then calls `run_full_pipeline`, which executes the integrated Dev1–Dev3 flow, and writes the aggregated report to `pipeline_report.json` unless another path was supplied.

The function `run_full_pipeline` begins by loading the CSV and running the Dev1 data pipeline, which validates the target, drops rows with missing targets, removes duplicate rows, and fails fast if nothing remains. Features and targets are split, and copies are taken so downstream sklearn importers never see fragile pandas views. The leakage guard runs on the feature frame against the target, and any dropped columns are recorded under `data_report.leakage_guard` along with a human-readable note. A scaling strategy is inferred from the number of rows and the counts of numeric versus categorical columns. Depending on that strategy, the code may replace high-cardinality categoricals with frequency-encoded numeric columns and may compress wide tables by dropping near-constant numerics, highly correlated numerics, or excess columns up to a cap. The frame may then be downcast from float64 to float32 to save memory. A column transformer preprocessor and a SelectKBest selector are built using the strategy’s flags. Cross-validation scores are produced by `train_models_core`, and the best models are ranked by F1 weighted for classification or R2 for regression. The top four names are intersected with the concrete estimators from `smart_model_selector`. Stacking is enabled when there is more than one ranked model and the gap between the top two scores is within 0.02; for classification, the CLI path additionally requires that every class has at least two samples in the full target vector so stratified procedures remain valid. Either a stacking ensemble or a single best model is then passed to `final_training`, which produces a held-out test split and fits the full pipeline. Baseline metrics come from `evaluate`. Dev3’s `optimize_model` receives that fitted pipeline and the train and test data, along with the scaling strategy, and returns a possibly improved final estimator and a detailed decision record. Local runs then call plotting helpers for confusion matrices, ROC, residuals, permutation importance, and similar views.

One subtle but important detail is that `run_pipeline_api.py` uses almost the same ensemble rule but does not require the minimum class count check that `dev1_data_pipeline.py` applies. If you ever see stacking differ between the CLI and the web app on a borderline classification dataset, that difference in gating is the first place to compare.

Target resolution walks from an exact column name match to a case-insensitive unique match, then to a small set of conventional aliases such as `target`, `label`, or `class`. If the user’s string matches one of those aliases and the table has more than one column, the implementation falls back to the last column with a warning, which helps with imperfect exports and checkpoint files.

### 2.2 Web and API path: `backend/python/run_pipeline_api.py`

This module is designed for automation: there is no interactive prompt, and anything that would call `plt.show` is redirected to save PNG files. Standard output must remain machine-parseable so Node can find a final JSON object and optional `PROGRESS:` lines.

The helper `_ensure_automl_sys_path` prepends the resolved automl source root (two levels above the script file) to `sys.path` and removes duplicate entries that would otherwise let an older copy of `dev2_automl_doctor.py` under `PROJECT_ROOT` shadow the version shipped with the repository. That keeps training behavior consistent with what developers expect from the main tree.

Dataset loading uses pandas `read_csv` in chunks of fifteen thousand rows. After roughly twenty thousand rows have been ingested, the code emits a progress message describing large ingest mode so the UI can reassure the user that work is proceeding.

The routine `train_and_collect` mirrors the logical steps of `run_full_pipeline` but layers on web-specific concerns. Throughout training it prints lines beginning with `PROGRESS:` followed by JSON objects containing stage name, percentage, and a short message; `pipelineService.js` parses those and persists throttled updates to Mongo. Matplotlib’s Agg backend is installed and `plt.show` is monkey-patched so figures are written under `generated/{runId}-plots/` instead of popping windows. When the caller passes `--visualizations yes`, Dev0 runs with an optional scaling strategy so large tiers skip the heaviest exploratory plots.

If the training frame has more than one hundred thousand rows and the scaling strategy enables chunk training, the pipeline shuffles indices, trains additional pipelines on successive fifteen-thousand-row slices (cloned from the same model family chosen for Dev2), and if more than one such model survives, wraps them in `ChunkEnsembleModel`. That replaces the final model used for serialization and metrics in that run.

The `main()` CLI of this script writes the report JSON and pickle under the configured generated directory, emits a stub `train.py` that re-invokes `run_full_pipeline`, and prints a single JSON blob listing report paths, model path, feature column order, and relative plot paths. The Node helper `parseLastJsonObject` scans stdout from the bottom upward to recover that object even if libraries printed noisy lines earlier.

---

## 3. Dev0 — exploratory data analysis (`dev0.py`)

Dev0 exists to give a human-readable tour of the dataset before or alongside AutoML. It loads CSVs with stripped headers, resolves the target the same way Dev1 does so labels stay aligned across tools, and distinguishes probable identifier columns from useful predictors by checking whether every non-null value in a column is unique. Plot selection prioritizes informative numeric and categorical columns while capping how many bivariate and univariate views are produced so runs stay bounded on wide tables. Constants such as `MAX_BIVARIATE_NUM_NUM` and `SAMPLE_ROWS_FOR_PLOTS` bound work for large files. When Dev0 is invoked from `run_pipeline_api`, the active `ScalingStrategy` tightens how many rows feed plots and whether pair plots, KDEs, or heatmap annotations appear, which keeps cloud training from spending minutes only on EDA.

---

## 4. Dev2 — AutoML doctor (`dev2_automl_doctor.py`)

Problem type detection inspects the target’s dtype and cardinality. Numeric targets with many distinct values are usually treated as regression even when the unique ratio is not extreme, while limited cardinality favors classification. Column typing treats standard integer and float dtypes as numeric and routes everything else into a categorical branch for one-hot encoding after imputation.

The leakage guard iterates each feature column and removes it if it behaves like an identifier with all unique non-null values, if it equals the target column row for row, if it is numeric and Pearson correlation with the target exceeds an absolute threshold controlled by `AUTOML_LEAKAGE_CORR_ABS` defaulting to 0.995, or if normalized mutual information between encodings of the feature and target exceeds `AUTOML_LEAKAGE_NMI_MAX` defaulting to 0.90. High-cardinality floating columns skip the NMI branch because binning noise can cause false drops. Encoding helpers discretize numerics with quantile bins or factorize categoricals so NMI is meaningful on mixed data.

Preprocessing builds separate sklearn pipelines for numeric and categorical columns, then combines them in a `ColumnTransformer`. Numeric data use either an iterative imputer with median initialization plus standard scaling when the strategy allows, or a simple median imputer plus scaler otherwise. A small function transformer forces writable arrays to avoid subtle failures. Categorical columns use most-frequent imputation and a one-hot encoder that ignores unknown levels at prediction time, optionally emitting sparse matrices when the strategy says the design matrix would be huge.

For imbalanced classification, the code checks whether the minority class share is below thirty percent or the ratio of majority to minority exceeds four. If so, two complementary mechanisms apply. At the data level, if the full dataset row count is at least ten thousand, random undersampling is inserted after the preprocessor; otherwise SMOTE with a neighbor count derived from the smallest class size is used. The imbalanced-learn pipeline variant places that sampler between preprocessing and later steps so models see balanced or reduced designs where appropriate. At the algorithm level, tree-based classifiers (RandomForest, DecisionTree, and LightGBM) are constructed with `class_weight='balanced'`, which assigns weights inversely proportional to class frequencies. GradientBoostingClassifier does not expose a `class_weight` parameter but can receive sample weights at fit time through the pipeline interface if needed. XGBoost controls class imbalance via `scale_pos_weight` (binary only), which is left for the caller to configure. Together, SMOTE or undersampling handle data-level balancing while class weighting adjusts the loss function, giving two independent handles on the same problem.

Feature selection is always SelectKBest with `f_classif` or `f_regression`, with k capped by both the strategy’s `feature_selection_k` and the actual column count. Feature engineering without a strategy uses a legacy composite that may add PCA on medium-sized wide numeric sets and low-degree polynomials on narrow sets. With a strategy, `_ScalableFeatureEng` may add polynomials under row and column guards, then apply truncated SVD, incremental PCA, or standard PCA depending on flags and shapes, honoring a global switch to skip polynomials entirely on large or wide problems.

Cross-validation builds a model dictionary from `smart_model_selector`, truncates to the strategy’s `cv_max_models` and again inside `train_models_core` to at most eight, and in memory-safe mode tightens that cap further. If the frame has more rows than `cv_sample_cap`, only a fixed random subsample is used for cross-validation to save time, but the final fit still uses the full data after an eighty-twenty split. The CV splitter is stratified for classification when each class has enough samples, otherwise KFold, and the number of splits respects both the data and the strategy. Scoring uses F1 weighted or R2, and job count follows `_parallel_jobs`, which collapses to one worker when `AUTOML_MEMORY_SAFE` or `RENDER` is set. On Render deployments the memory-safe path also caps the candidate count to three models, further reducing peak RAM.

The model zoo is data-dependent. On small sets and when the strategy allows slow models, you may see k-nearest neighbors, naive Bayes, support vector machines, logistic or linear models, and shallow trees. From ten thousand rows upward, or when only scalable estimators are allowed, random forests and gradient boosting dominate with row-scaled tree depth and estimator counts. When the strategy enables gradient boosting libraries or the row count exceeds forty thousand, optional XGBoost and LightGBM estimators appear if imports succeed; failures are swallowed so sklearn-only environments still run. Before cross-validation the candidate dict is optionally reordered and truncated using a priority list that prefers gradient boosting libraries, forests, boosting, then linear-like models.

Stacking ensembles are built with sklearn’s stacking meta-estimators, using logistic regression as the final layer for classification and linear regression for regression. Final training repeats the imbalance sampler logic keyed off the full training set size, stratifies the split when possible, and fits the assembled pipeline end to end.

Evaluation for reporting enriches the basic accuracy or R2 story with weighted precision, recall, and F1 for classification plus ROC-AUC when probabilities exist, and adds MAE and RMSE for regression with compatibility for sklearn versions that lack the squared argument on mean squared error.

The standalone helper `run_automl` omits leakage handling and scalable strategy wiring relative to production paths. A prior version of this function referenced an undefined `scaling` variable near `final_training`; that has been corrected by passing `scaling_strategy=None` explicitly to `final_training`, so the method is safe to use for quick experiments.

---

## 5. Dev3 — optimization (`dev3_auto_optimization.py`)

Dev3 evaluates the already-fitted Dev2 pipeline on train and test using a lighter metric set than the final report: accuracy for classification and R2 for regression. It classifies the situation as overfitting when the train score exceeds the test score by more than a gap that depends on task type and a small adjustment for sample size, underfitting when both scores sit below modest floors, and “good” otherwise. For classification it also asks whether the training labels look imbalanced with the same ratio rules used in Dev2.

Candidate estimators are generated in full detail or via a reduced fast path when `dev3_fast` is on or the training set is very large. Both paths include optional XGBoost and LightGBM estimators alongside sklearn’s native GradientBoosting, guarded by try/except imports so the code degrades gracefully when those packages are absent. The full path also includes LogisticRegression, SVM, KNN, DecisionTree, RandomForest, NaiveBayes, and regression equivalents. Hyperparameters on tree-based candidates respond to the detected issue: overfitting tightens `max_depth` and `num_leaves` while lowering `learning_rate`, while underfitting relaxes them.

Each candidate keeps the preprocessing and selector architecture by cloning the sklearn pipeline and swapping only the final estimator step, then refitting on training data. The best candidate by test score is retained only if it meets or beats the original test score; otherwise the baseline model wins and the selected version metadata records that choice.

After the candidate loop, if the problem is classification, the final model is wrapped in `CalibratedClassifierCV` with cross-validation (3 folds for datasets under 50k rows, 2 folds under 150k, skipped above). This applies Platt scaling (sigmoid) to produce better-calibrated `predict_proba` outputs, which improves ROC AUC reliability without changing class predictions. The calibrator clones the final estimator and refits on each CV fold; ensemble averaging combines the per-fold calibrators at inference time. Any calibration failure is caught silently so the pipeline falls back to the uncalibrated model.

If the strategy enables randomized search on forest-like final estimators with a positive iteration count, an additional RandomizedSearchCV may fine-tune tree hyperparameters when the outer pipeline’s last step names a forest classifier or regressor. A successful improvement can mark the selected version as `randomized_search`. Any estimator that throws during fit is captured as a string in `failed_candidates` for transparency in the report.

---

## 6. Scalable strategy (`scalable_strategy.py`)

`ScalingStrategy` is an immutable dataclass summarizing every policy knob the rest of the code consults, and `to_report_dict` flattens it for JSON. Row count drives a primary tier labeled XS for under ten thousand rows, S for under fifty thousand, M for up to one hundred thousand, and L beyond that. XS favors iterative imputation, five cross-validation folds, up to four models in the CV loop, richer feature engineering and EDA, and no chunk training. RandomizedSearchCV is enabled on XS with 10 iterations and 3 CV splits, targeting forest-based final estimators. S tightens to two CV models, accelerates Dev3, simplifies EDA, and typically uses sparse one-hot output. RandomizedSearchCV is enabled on S with 6 iterations and 2 CV splits. M and L tiers use no randomized search to keep cloud training time bounded. M forces scalable estimator families, incremental PCA and truncated SVD when shapes demand it, sparse encoding, aggressive wide-table handling, optional chunk training once eighty thousand rows are reached, and a read chunk size hint around fifteen thousand. L is the strictest tier for caps and defaults chunk training off to avoid multiplying full fits across many shards, with comments in code about wall-clock cost.

Whenever total feature count exceeds five hundred columns, overlays force skipping polynomials, leaning on truncated SVD, lowering maximum feature caps after compression toward two hundred, and capping selector k. Moderate widths above one hundred columns always engage wide-table filters regardless of tier.

Downstream modules read preprocessor flags such as iterative versus simple imputation, sparse one-hot, and float downcast. Cross-validation consumes `cv_n_splits`, `cv_sample_cap`, and `cv_max_models`. Feature pipelines read polynomial and dimensionality-reduction switches plus `feature_selection_k`. Wide data logic reads frequency encoding, variance and correlation thresholds, and maximum post-compression width. Model selection reads whether KNN and SVM are allowed, whether only scalable models run, and whether boosting libraries are attempted, plus `n_jobs` where applicable. Dev3 reads `dev3_fast` and optional randomized search parameters. Chunk training and ingest hints read `use_chunk_training` and `read_chunk_size`.

---

## 7. Wide tables and memory (`scalable_table.py`, `scalable_preprocessing.py`)

Frequency encoding replaces each categorical column with a numeric column named with a `__freq` suffix whose values are the relative frequencies of the original categories in the training frame, which collapses cardinality before one-hot explosion in some tiers. Wide compression drops numeric columns with negligible variance, then scans pairwise correlations and drops redundant partners when correlation exceeds a threshold near one, optionally pre-filtering to the highest-variance numerics when the matrix would be enormous. If the combined feature count still exceeds `max_total_features_after_compress`, the code keeps the strongest numeric signals by variance, trims categorical columns from the tail, and drops stray extras. `prepare_frame_memory` optionally converts float64 columns to float32 when the strategy requests downcasting, which can materially reduce peak RAM on large grids.

---

## 8. Chunk ensemble (`backend/python/chunk_ensemble_model.py`)

`ChunkEnsembleModel` stores a list of fitted sklearn-compatible estimators. At prediction time for regression it stacks predictions and returns the elementwise mean. For classification it majority-votes per row. When every submodel exposes `predict_proba`, it aligns class index order across models and averages probability vectors, building a unified `classes_` array from the union of member labels. This type is only attached in the API training path when chunk training succeeds with more than one chunk model.

---

## 9. Report JSON shape (conceptual)

Integrated runs produce a JSON-compatible tree whose top level includes `data_report` with row counts, column names, leakage guard details, optional notes on frequency encoding and wide compression, and often an embedded copy of the scaling strategy dict. The string `problem_type` is either classification or regression. A second `scaling_strategy` key may repeat the policy snapshot for convenience. The `dev2` object carries ranked model names and scores, whether a single model or ensemble was chosen, and baseline evaluation metrics on the holdout split. The `dev3` object records which simple metric drove decisions, the detected issue such as overfitting, whether imbalance was flagged, which model version won among original, improved, or randomized search branches, scalar before and after train and test scores for the selection loop, per-candidate score maps, string error maps for failed candidates, the final rich metric dict from Dev2’s `evaluate`, and metadata about whether chunk ensembles ran including row thresholds. The CLI path converts numpy scalars through `_sanitize_dict` for clean JSON; the API path may stringify some values when writing to disk through default handlers.

---

## 10. Backend (Node.js)

The Express application enables `trust proxy` so secure cookies and client IP logic behave behind Render or similar hosts. CORS allows credentials and whitelists origins from `CLIENT_URL`, with additional acceptance for typical Vercel and Render hostnames. Generated artifacts are exposed as static files under `/generated` so the React app can render plot images by URL. Routers mount at `/api/auth`, `/api/runs`, and `/api/streamlit`. Streamlit is reverse-proxied to localhost on `STREAMLIT_PORT` with WebSocket upgrade handling; `changeOrigin` stays false because Streamlit’s handshake is sensitive to the Host header. Graceful shutdown on SIGTERM or SIGINT closes the HTTP server and Mongo.

Path resolution prefers `DATA_DIR`, under which uploads and generated subdirectories are created, falling back to explicit `UPLOADS_DIR` and `GENERATED_DIR` overrides or defaulted folders beside the server working directory.

Authentication routes hash passwords with bcrypt at cost ten on signup, issue JWTs lasting seven days with user id and email claims, expose a password change endpoint with a six-character minimum for the new secret, and support account deletion with password confirmation which deletes associated run histories and marks the user inactive with a deletion timestamp rather than physically removing every trace immediately.

Runs routes sit entirely behind JWT middleware. Listing returns up to one hundred recent jobs for the authenticated user; fetching one document returns the embedded report and paths subject to ownership checks. PATCH updates project labeling and visibility flags. Progress polling exposes status, percentages, timestamps, and last error strings without shipping the entire report blob on every poll. Execution accepts multipart uploads with target column plus optional visualization and project naming fields, replies immediately with HTTP 202 and the run document, and continues work asynchronously. Deletion removes database rows and attempts to unlink uploaded datasets, serialized models, reports, scripts, plot files, and generated directory trees keyed by run identifiers. Prediction posts a JSON object of feature name to value pairs. Visualization posts a mode, plot type list, and column selections for the Python chart script. A merge endpoint appends trusted `/generated/` URLs into the run record for user-curated galleries. Download endpoints stream tailored Python or notebook content built from `trainingExport.js`.

The execute worker saves uploads through multer, creates a `RunHistory` row in the running state, fills preview columns from `readCsvPreview`, then spawns Python with a composite run id so artifacts never collide. Progress callbacks update Mongo when the stage changes, the percentage moves by at least five points, or roughly half a second elapsed since the last write, preventing excessive database chatter. Success stores capped plot URL lists, resolved absolute paths, feature columns, final metrics summary, and stderr logs; failure records an error string and marked failure status.

`pipelineService` chooses the Python executable from environment or platform defaults, accumulates stdout and stderr, extracts progress JSON from dedicated lines, and on exit code zero parses the last JSON object as the contract for training completion. A configurable timeout (default 30 minutes, controlled by `PYTHON_PIPELINE_TIMEOUT_MS`) kills the Python child process tree if it exceeds the limit, preventing zombie processes. On Windows the kill uses `taskkill /f /t`; on Unix it sends SIGKILL. Prediction and visualization helpers write short-lived JSON payloads beside generated content and delete them after the child exits. A debug hook posts optional telemetry to a localhost ingest URL and fails silently if nothing listens.

CSV preview uses `csv-parse` in streaming mode with relaxed column counts and BOM handling, stopping after enough rows are buffered for the UI. Before starting any pipeline, the upload endpoint validates the CSV file: it checks a server-side size limit (configurable via `MAX_FILE_SIZE_MB`, default 200 MB), verifies the file parses as valid CSV with at least one data row and one column, confirms the target column exists, rejects datasets where the target is constant (all same value), and refuses files whose target column has every unique value (probable identifier or row index). The client-side upload form mirrors these checks with file extension and size screening before the POST is sent.

CSV preview uses `csv-parse` in streaming mode with relaxed column counts and BOM handling, stopping after enough rows are buffered for the UI.

`trainingExport.js` is a large template engine that inspects the saved report to decide which sklearn imports and pipeline stages to emit, approximating iterative imputation and dimensionality heuristics from row and feature counts, and produces both a `.py` file and an `.ipynb` JSON document a user can run offline.

The Streamlit route discovers the Streamlit app path and runtime directory, infers whether each feature column behaves like a number or text from preview rows, builds a human-readable final model label from Dev2 and Dev3 metadata, manages process lifecycle and context files such as `active_context.json`, and exposes a public URL helper that respects `PUBLIC_BASE_URL` or Render’s external URL environment variable.

---

## 11. Frontend (React)

The application boots from `main.jsx` with React strict mode, client-side routing, a dialog provider, and i18n initialization. Until a JWT-backed user exists in the auth store, every route redirects to the auth page. After login, the layout shows a responsive sidebar with navigation to run a new job, browse history, manage projects, open settings, and deep-link into a specific run with optional `section` query parameters for dashboard, visualizations, prediction, and similar views. Theme choice applies a `data-theme` attribute for dark mode styling, and language choice propagates into i18next resources for English and Hindi.

The axios instance targets `VITE_API_BASE_URL` and attaches the bearer token from local storage on each request. Feature components include a form for dataset upload and target selection, a run detail surface with metrics cards and accordions for the model report, sections for single-row prediction against the saved pickle, builders that POST visualization specs and render returned images from `/generated`, a voice assistant that maps speech transcripts to navigation and synthetic UI actions through the Web Speech API where available, shared dialogs, loading chrome, and small utilities that format run labels and filter which items appear in project overviews. Dependencies include react-router-dom in the v7 line, zustand, recharts and other presentation libraries listed in `package.json`.

---

## 12. Streamlit companion app

The Streamlit page configuration sets a wide layout and a product title. On each interaction the app checks modification time of `runtime/active_context.json`; if the backend rewrote that file when the user launched Streamlit for a different run, caches and session state reset so the UI cannot silently score against the wrong model. Pickle loading is wrapped in `st.cache_resource` keyed by normalized path and file mtime so model updates invalidate cache correctly. Helper modules coerce user inputs into a one-row frame matching training columns. If the context file is absent, environment variables can still point to model path, metadata path, and project root for standalone deployments.

---

## 13. Environment variables (narrative)

On the server, `PORT` selects the listen port with a four-thousand default. `MONGODB_URI` connects Mongoose. `JWT_SECRET` signs tokens. `CLIENT_URL` drives CORS and may be comma-separated for multiple frontends. `PROJECT_ROOT` should point at a directory whose Python path story matches your deployment; the bridge also prepends the bundled automl root for consistency. `PYTHON_EXECUTABLE` overrides interpreter discovery on Windows or exotic PATH layouts. `DATA_DIR` is the recommended Render pattern for durable disks, with optional finer overrides for upload and generated paths. Streamlit integration uses `STREAMLIT_PORT`, `STREAMLIT_PUBLIC_MOUNT`, and either `PUBLIC_BASE_URL` or `RENDER_EXTERNAL_URL` so links in the UI resolve correctly. Additional `AUTOML_*` variables back the Streamlit app when JSON context is missing.

The Vite frontend reads `VITE_API_BASE_URL` for REST calls and `VITE_BACKEND_BASE_URL` when building absolute asset or proxy URLs.

Python training honors `AUTOML_MEMORY_SAFE` and `RENDER` for conservative parallelism, and `AUTOML_LEAKAGE_NMI_MAX` plus `AUTOML_LEAKAGE_CORR_ABS` for leakage tuning without code edits.

---

## 14. Python dependencies

The backend requirements file pins compatible ranges for numpy, pandas, scikit-learn, visualization libraries, Streamlit, imbalanced-learn, scipy, xgboost, and lightgbm. If gradient boosting libraries fail to import at runtime, Dev2 simply omits those keys from the candidate map.

---

## 15. Security and operations

JSON Web Tokens live in browser local storage, which is standard for SPAs but implies that cross-site scripting in the frontend could exfiltrate tokens, so production deployments should enforce HTTPS, strict content security policies, and careful handling of any HTML injection. Pickled models are not a secure serialization format for untrusted bytes; only load pickles you generated yourself. The plot merge API rejects URLs that do not start with `/generated/` and resolves paths only under the configured generated root, which closes naive directory traversal. Broad CORS allowances for Vercel and Render host suffixes are convenient for demos but may be tighter in private environments. The optional debug POST inside `pipelineService` should be removed or gated if it causes noise or concern. Account deletion soft-deactivates users and removes their run history documents from Mongo but does not automatically purge external backups. On Render without a persistent disk mounted at `DATA_DIR`, uploaded files and trained models disappear on redeploy, which is expected for ephemeral disks.

---

## 16. Interaction flows in words

When a user starts training from the web UI, the client posts multipart data to the runs execute endpoint. The API creates a database record marked running and returns immediately so the browser can poll progress. A child Python process runs `run_pipeline_api`, streaming progress lines that the parent parses and writes to Mongo on a throttled schedule. When the process exits successfully, the parent reads the final JSON payload, stores report and filesystem paths, caps how many plot URLs are kept, and marks the job complete. The UI polls the lightweight progress endpoint during training and then loads the full run document for dashboards and downloads.

Prediction begins when the UI posts a flat JSON object of feature values. The backend locates the saved pickle for that user’s run, writes a temporary JSON file with the payload, invokes `predict_api.py`, parses stdout JSON into prediction and optional probability, and returns that object to React.

---

## 17. Troubleshooting in prose

If Windows cannot spawn Python, ensure either `PYTHON_EXECUTABLE` points at a working interpreter or the `py` launcher is installed. Empty or missing JSON in training logs usually means stderr swallowed the traceback or `PROJECT_ROOT` misaligned paths; inspect the `logs` field on the failed run. Streamlit websocket failures often trace to mismatched base URL paths between Streamlit’s own `baseUrlPath` configuration and `STREAMLIT_PUBLIC_MOUNT`, or to incorrectly toggling proxy `changeOrigin`. Memory exhaustion on large CSV paths may still occur after chunked reading because concatenation retains the full frame; vertical scaling or column filtering may be necessary. Divergent stacking between CLI and web traces back to the extra minimum class count guard in `dev1_data_pipeline.py`. Missing boosting libraries after deploy means the pip step in the build command failed or optional wheels were skipped; the rest of the stack still operates on sklearn estimators.

---

## 18. Where to extend the product safely

Model breadth and default hyperparameters are centralized in `smart_model_selector` and Dev3’s candidate builders, so new families or tuned defaults belong there first. Tier boundaries and overlays live in `infer_scaling_strategy` if you need different tradeoffs for your hardware. Leakage aggressiveness is environment-driven. If product requirements change which metrics appear in executive summaries, update `evaluate` and keep Dev3’s selection metric compatible or intentionally decoupled. New dashboard sections typically mean extending `RunDetailsPage` and possibly the sidebar query parameter handling in `App.jsx`. Downloadable teaching artifacts are entirely generated in `trainingExport.js`.

---

## 19. Glossary

Dev1, Dev2, and Dev3 are informal stage names for data preparation, automated model search and training, and post-hoc improvement respectively. The scaling strategy object is the single policy bundle that makes behavior depend on dataset shape. Chunk ensemble refers to optional extra models trained on disjoint row blocks and merged through `ChunkEnsembleModel`. A RunHistory document is the Mongo representation of one end-to-end training execution including paths to artifacts and embedded report snapshots.

---

This reference was written to describe the `automl` codebase as implemented. If the source changes, treat the repository as authoritative and revise this narrative to match.
