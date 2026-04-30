import { useMemo, useState } from "react";
import api from "../api";

function PredictionSection({ run }) {
  const featureColumns = useMemo(() => run?.featureColumns || [], [run?.featureColumns]);
  const previewRows = useMemo(() => run?.previewRows || [], [run?.previewRows]);

  const [jsonInput, setJsonInput] = useState("{}");
  const [manualInput, setManualInput] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const featureTypes = useMemo(() => {
    const types = {};
    for (const col of featureColumns) {
      let detected = "text";
      for (const row of previewRows) {
        const raw = row?.[col];
        if (raw === null || raw === undefined || String(raw).trim() === "") continue;
        const n = Number(raw);
        if (!Number.isNaN(n) && Number.isFinite(n)) detected = "number";
        break;
      }
      types[col] = detected;
    }
    return types;
  }, [featureColumns, previewRows]);

  if (!run?._id) return null;

  const requestPrediction = async (features) => {
    setError("");
    setResult(null);
    try {
      const { data } = await api.post(`/runs/${run._id}/predict`, { features });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const submitJsonPrediction = async () => {
    const parsed = JSON.parse(jsonInput);
    await requestPrediction(parsed);
  };

  const submitManualPrediction = async () => {
    const payload = {};
    for (const col of featureColumns) {
      const value = manualInput[col];
      if (value === "") continue;
      if (featureTypes[col] === "number") {
        const n = Number(value);
        payload[col] = Number.isFinite(n) ? n : value;
      } else {
        payload[col] = value;
      }
    }
    await requestPrediction(payload);
  };

  return (
    <div className="panel">
      <h2>Prediction Sandbox</h2>
      <p>Enter features manually or paste one JSON row, then run prediction.</p>

      <div className="field">
        <label>Manual Feature Input</label>
        <div className="metrics-grid">
          {featureColumns.map((col) => (
            <div key={col} className="field">
              <label>{col}</label>
              <input
                type={featureTypes[col] === "number" ? "number" : "text"}
                value={manualInput[col] ?? ""}
                onChange={(e) =>
                  setManualInput((prev) => ({ ...prev, [col]: e.target.value }))
                }
                placeholder={featureTypes[col] === "number" ? "Numeric value" : "Text value"}
              />
            </div>
          ))}
        </div>
        <button className="secondary-btn" onClick={submitManualPrediction}>
          Predict (Manual Input)
        </button>
      </div>

      <div className="field">
        <label>JSON Input</label>
        <textarea
          className="json-area"
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
        />
        <button className="secondary-btn" onClick={submitJsonPrediction}>Predict (JSON)</button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {result && <pre className="code-block">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}

export default PredictionSection;
