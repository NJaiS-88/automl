import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { gsap } from "gsap";
import { FiCheckCircle } from "react-icons/fi";
import api from "../api";

function PredictionSection({ run }) {
  const sectionRef = useRef(null);
  const featureColumns = useMemo(() => run?.featureColumns || [], [run?.featureColumns]);
  const previewRows = useMemo(() => run?.previewRows || [], [run?.previewRows]);

  const [jsonInput, setJsonInput] = useState("{}");
  const [manualInput, setManualInput] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

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

  useEffect(() => {
    if (!sectionRef.current) return;
    gsap.fromTo(
      sectionRef.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }
    );
  }, []);

  const requestPrediction = async (features) => {
    if (!run?._id) return;
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const { data } = await api.post(`/runs/${run._id}/predict`, { features });
      setResult(data);
      setShowSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
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

  const clearPredictionInputs = () => {
    setManualInput({});
    setJsonInput("{}");
    setResult(null);
    setError("");
  };

  if (!run?._id) return null;

  return (
    <motion.div
      ref={sectionRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px", position: "relative" }}
    >
      <style>
        {`
          @keyframes predict-spin {
            to { transform: rotate(360deg); }
          }
        `}
      </style>
      <h2>Prediction Sandbox</h2>
      <p>Enter one row in a spreadsheet-style table or paste JSON payload.</p>
      <div style={{ display: "grid", gap: "8px", marginBottom: "14px" }}>
        <label>Spreadsheet Input</label>
        <div style={{ overflow: "auto", border: "1px solid #f1f5f9", borderRadius: "10px" }}>
          <table style={{ width: "100%", minWidth: "max-content", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {featureColumns.map((col) => (
                  <th key={col} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {featureColumns.map((col) => (
                  <td key={col} style={{ padding: "8px 10px", borderBottom: "1px solid #f1f5f9" }}>
                    <input
                      type={featureTypes[col] === "number" ? "number" : "text"}
                      value={manualInput[col] ?? ""}
                      onChange={(e) =>
                        setManualInput((prev) => ({ ...prev, [col]: e.target.value }))
                      }
                      placeholder={featureTypes[col] === "number" ? "0.00" : "value"}
                      style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px 10px", background: "#ffffff" }}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <button onClick={submitManualPrediction} disabled={loading} style={{ border: "none", background: "#111111", color: "#ffffff", borderRadius: "10px", padding: "10px 12px", fontWeight: 600, width: "fit-content", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
          Predict (Spreadsheet)
        </button>
      </div>

      <div style={{ display: "grid", gap: "8px" }}>
        <label>JSON Input</label>
        <textarea
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          style={{ minHeight: "120px", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "10px 12px", background: "#ffffff", resize: "vertical" }}
        />
        <button onClick={submitJsonPrediction} disabled={loading} style={{ border: "none", background: "#111111", color: "#ffffff", borderRadius: "10px", padding: "10px 12px", fontWeight: 600, width: "fit-content", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
          Predict (JSON)
        </button>
      </div>

      {loading && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,0.28)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "12px 14px", display: "inline-flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
            <span style={{ width: "16px", height: "16px", borderRadius: "50%", border: "2px solid #cbd5e1", borderTopColor: "#111827", animation: "predict-spin 0.8s linear infinite" }} />
            Predicting...
          </div>
        </div>
      )}
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      <AnimatePresence>
        {result && (
          <motion.pre
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            style={{ marginTop: "12px", border: "1px solid #f1f5f9", borderRadius: "10px", padding: "10px", background: "#ffffff", overflowX: "auto" }}
          >
            {JSON.stringify(result, null, 2)}
          </motion.pre>
        )}
      </AnimatePresence>

      {showSuccess && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,0.28)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", padding: "12px" }}>
          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px", width: "min(360px, 100%)", textAlign: "center" }}>
            <FiCheckCircle style={{ fontSize: "24px", color: "#111827" }} />
            <h3>Prediction completed</h3>
            <p>Your prediction result is ready below.</p>
            <button
              type="button"
              onClick={() => setShowSuccess(false)}
              style={{ border: "none", background: "#111111", color: "#ffffff", borderRadius: "10px", padding: "10px 12px", fontWeight: 600, cursor: "pointer" }}
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default PredictionSection;
