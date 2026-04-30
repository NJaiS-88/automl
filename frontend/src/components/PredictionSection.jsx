import { useState } from "react";
import api from "../api";

function PredictionSection({ run }) {
  const [jsonInput, setJsonInput] = useState("{}");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  if (!run?._id) return null;

  const submitPrediction = async () => {
    setError("");
    setResult(null);
    try {
      const parsed = JSON.parse(jsonInput);
      const { data } = await api.post(`/runs/${run._id}/predict`, { features: parsed });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  return (
    <div className="panel">
      <h2>Prediction Sandbox</h2>
      <p>Paste one row as JSON with all feature names, then predict.</p>
      <textarea
        className="json-area"
        value={jsonInput}
        onChange={(e) => setJsonInput(e.target.value)}
      />
      <button className="secondary-btn" onClick={submitPrediction}>Predict</button>
      {error && <p className="error-text">{error}</p>}
      {result && <pre className="code-block">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}

export default PredictionSection;
