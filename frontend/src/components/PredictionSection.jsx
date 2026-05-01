import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { gsap } from "gsap";
import { FiCheckCircle, FiMic, FiMicOff } from "react-icons/fi";
import api from "../api";
import useVoiceNavigator from "../hooks/useVoiceNavigator";
import SilverLoader from "./SilverLoader";

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

  const {
    transcript,
    listening,
    browserSupportsSpeechRecognition,
    resetTranscript,
    start,
    stop,
  } = useVoiceNavigator([
    {
      phrases: ["predict now", "run prediction"],
      onMatch: () => submitManualPrediction(),
    },
    {
      phrases: ["clear prediction", "reset prediction"],
      onMatch: () => clearPredictionInputs(),
    },
  ]);

  if (!run?._id) return null;

  return (
    <motion.div
      className="panel"
      ref={sectionRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h2>Prediction Sandbox</h2>
      <p>Enter one row in a spreadsheet-style table or paste JSON payload.</p>
      {browserSupportsSpeechRecognition && (
        <div className="voice-row">
          <button
            type="button"
            className="secondary-btn"
            onClick={listening ? stop : start}
          >
            {listening ? <FiMicOff /> : <FiMic />} {listening ? "Stop Voice" : "Start Voice"}
          </button>
          <button type="button" className="secondary-btn" onClick={resetTranscript}>
            Clear Voice Text
          </button>
          <span className="voice-transcript">Heard: {transcript || "..."}</span>
        </div>
      )}

      <div className="field prediction-table-wrap">
        <label>Spreadsheet Input</label>
        <div className="dataset-preview-scroll">
          <table className="dataset-table prediction-table">
            <thead>
              <tr>
                {featureColumns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {featureColumns.map((col) => (
                  <td key={col}>
                    <input
                      type={featureTypes[col] === "number" ? "number" : "text"}
                      value={manualInput[col] ?? ""}
                      onChange={(e) =>
                        setManualInput((prev) => ({ ...prev, [col]: e.target.value }))
                      }
                      placeholder={featureTypes[col] === "number" ? "0.00" : "value"}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <button className="secondary-btn" onClick={submitManualPrediction} disabled={loading}>
          Predict (Spreadsheet)
        </button>
      </div>

      <div className="field">
        <label>JSON Input</label>
        <textarea
          className="json-area"
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
        />
        <button className="secondary-btn" onClick={submitJsonPrediction} disabled={loading}>
          Predict (JSON)
        </button>
      </div>

      {loading && (
        <div className="content-overlay silver">
          <div className="overlay-content loading-overlay-content">
            <SilverLoader text="Predicting with silver glow..." />
          </div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <AnimatePresence>
        {result && (
          <motion.pre
            className="code-block"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            {JSON.stringify(result, null, 2)}
          </motion.pre>
        )}
      </AnimatePresence>

      {showSuccess && (
        <div className="content-overlay dark">
          <div className="overlay-content prediction-success-modal">
            <FiCheckCircle className="overlay-icon prediction-success-icon" />
            <h3>Prediction completed</h3>
            <p>Your prediction result is ready below.</p>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowSuccess(false)}
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
