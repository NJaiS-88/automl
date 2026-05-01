import { useMemo, useState } from "react";
import Papa from "papaparse";
import {
  FiActivity,
  FiArrowRight,
  FiBarChart2,
  FiCheckCircle,
  FiCpu,
  FiDatabase,
  FiLoader,
  FiUploadCloud,
} from "react-icons/fi";

const LOADING_STEPS = [
  {
    key: "analyzing",
    title: "Analyzing your dataset",
    subtitle: "Inspecting schema, data types, and missing values.",
    icon: FiDatabase,
  },
  {
    key: "preprocessing",
    title: "Preprocessing and cleaning",
    subtitle: "Handling nulls, encoding categories, and preparing features.",
    icon: FiActivity,
  },
  {
    key: "training",
    title: "Training model candidates",
    subtitle: "Running AutoML search across strong algorithms.",
    icon: FiCpu,
  },
  {
    key: "evaluating",
    title: "Evaluating and finalizing",
    subtitle: "Comparing metrics and selecting the best pipeline.",
    icon: FiBarChart2,
  },
];

function RunForm({ onSubmit, loading, error, runProgress }) {
  const [uiStep, setUiStep] = useState(1);
  const [modalStep, setModalStep] = useState(null);
  const [file, setFile] = useState(null);
  const [targetCol, setTargetCol] = useState("");
  const [datasetHead, setDatasetHead] = useState({ columns: [], rows: [] });
  const loadingStepIndex = useMemo(() => {
    const stage = runProgress?.currentStage;
    const indexByStage = {
      analyzing: 0,
      preprocessing: 1,
      training: 2,
      evaluating: 3,
      finalize: 3,
      failed: 3,
    };
    return indexByStage[stage] ?? 0;
  }, [runProgress?.currentStage]);

  const currentLoadingStep = LOADING_STEPS[Math.min(loadingStepIndex, LOADING_STEPS.length - 1)];

  const parseDatasetHead = async (csvFile) => {
    const text = await csvFile.text();
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      preview: 5,
    });
    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    const columns = Array.isArray(parsed.meta?.fields) ? parsed.meta.fields : [];
    setDatasetHead({ columns, rows });
  };

  const handleFileSelected = async (nextFile) => {
    if (!nextFile) return;
    setFile(nextFile);
    setTargetCol("");
    await parseDatasetHead(nextFile);
    setUiStep(2);
    setModalStep(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const normalizedTarget = targetCol.trim();
    if (!file || !normalizedTarget || loading) return;
    if (datasetHead.columns.length && !datasetHead.columns.includes(normalizedTarget)) {
      return;
    }
    try {
      await onSubmit({ file, targetCol: normalizedTarget });
      setModalStep(null);
    } catch {
      // Parent store already captures and displays API errors.
    }
  };

  return (
    <>
      <form className="line-panel run-form-shell" onSubmit={handleSubmit}>
        <div className="step-strip">
          <div className={`step-chip ${uiStep >= 1 ? "active" : ""}`}>
            <span>Step 1</span> Dataset
          </div>
          <FiArrowRight />
          <div className={`step-chip ${uiStep >= 2 ? "active" : ""}`}>
            <span>Step 2</span> Target
          </div>
          <FiArrowRight />
          <div className={`step-chip ${loading ? "active" : ""}`}>
            <span>Step 3</span> Analyze
          </div>
        </div>

        <h2>New Training Run</h2>
        <p className="subtle-text">
          Guided flow: upload dataset, choose target column, then run full AutoML analysis.
        </p>
        <div className="run-form-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setModalStep("dataset")}
            disabled={loading}
          >
            {file ? "Change Dataset" : "Upload Dataset"}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setModalStep("target")}
            disabled={loading || !file}
          >
            {targetCol ? "Change Target" : "Select Target"}
          </button>
          <button
            className="primary-btn"
            type="submit"
            disabled={
              loading ||
              !file ||
              !targetCol.trim() ||
              (datasetHead.columns.length > 0 && !datasetHead.columns.includes(targetCol))
            }
          >
            Analyze Dataset
          </button>
        </div>

        <div className="run-form-meta">
          <p>
            <strong>Dataset:</strong> {file?.name || "Not selected"}
          </p>
          <p>
            <strong>Target:</strong> {targetCol || "Not selected"}
          </p>
        </div>

        {datasetHead.columns.length > 0 && (
          <section className="dataset-preview-full">
            <h3>Dataset head preview</h3>
            <div className="dataset-preview-scroll">
              <table className="dataset-table">
                <thead>
                  <tr>
                    {datasetHead.columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datasetHead.rows.map((row, idx) => (
                    <tr key={idx}>
                      {datasetHead.columns.map((col) => (
                        <td key={`${idx}-${col}`}>{String(row?.[col] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {error && <p className="error-text">{error}</p>}
      </form>

      {!loading && modalStep === "dataset" && (
        <div className="content-overlay dark">
          <div className="overlay-content">
            <FiUploadCloud className="overlay-icon" />
            <h3>Upload your dataset</h3>
            <p>Choose a CSV file to start the pipeline.</p>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => handleFileSelected(e.target.files?.[0] || null)}
            />
            <button type="button" className="secondary-btn" onClick={() => setModalStep(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {!loading && modalStep === "target" && (
        <div className="content-overlay dark">
          <div className="overlay-content">
            <FiCheckCircle className="overlay-icon" />
            <h3>Select target column</h3>
            <p>Choose the exact column to predict.</p>
            {datasetHead.columns.length > 0 ? (
              <select value={targetCol} onChange={(e) => setTargetCol(e.target.value)}>
                <option value="">Select target column</option>
                {datasetHead.columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="e.g. Churn / species / target"
                value={targetCol}
                onChange={(e) => setTargetCol(e.target.value)}
              />
            )}
            {targetCol && datasetHead.columns.length > 0 && !datasetHead.columns.includes(targetCol) && (
              <p className="error-text">Please choose a target from the dataset columns.</p>
            )}
            <button
              className="primary-btn"
              onClick={handleSubmit}
              disabled={!targetCol.trim() || (datasetHead.columns.length > 0 && !datasetHead.columns.includes(targetCol))}
            >
              Analyze Dataset
            </button>
            <button type="button" className="secondary-btn" onClick={() => setModalStep(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="content-overlay silver">
          <div className="overlay-content loading-overlay-content">
            <FiLoader className="overlay-icon spin" />
            <h3>{currentLoadingStep.title}</h3>
            <p>{runProgress?.stageMessage || currentLoadingStep.subtitle}</p>
            <div className="loading-step-track">
              {LOADING_STEPS.map((step, index) => {
                const StepIcon = step.icon;
                return (
                  <div key={step.key} className={`loading-step-item ${index <= loadingStepIndex ? "active" : ""}`}>
                    <StepIcon />
                    <span>{step.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default RunForm;
