import { resolveDev2BaseModelName, resolveFinalChosenModelLabel } from "../utils/runDisplay";

function ModelReportAccordion({ report, runStatus }) {
  if (!report) return null;
  const dev3 = report.dev3 || {};
  const candidateScores = dev3.candidate_scores || {};
  const candidateEntries = Object.entries(candidateScores);
  const finalMetricName = dev3.metric || "score";
  const selectedVersion = dev3.selected_model_version || "original";
  const finalModelName =
    resolveFinalChosenModelLabel(report, runStatus) ||
    resolveDev2BaseModelName(report) ||
    "—";

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px" }}>
      <h2 style={{ margin: "0 0 12px", color: "#111827" }}>Model Reports</h2>
      <details style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "10px 12px", marginBottom: "10px" }} open>
        <summary style={{ cursor: "pointer", fontWeight: 600, color: "#111827" }}>All Models Metrics ({candidateEntries.length})</summary>
        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {!candidateEntries.length && <p>No model metrics available.</p>}
          {candidateEntries.map(([modelName, scoreObj]) => (
            <div key={modelName} style={{ border: "1px solid #f1f5f9", borderRadius: "10px", padding: "8px 10px", display: "grid", gap: "4px" }}>
              <span><strong>{modelName}</strong></span>
              <span>train_{finalMetricName}: {typeof scoreObj?.train === "number" ? scoreObj.train.toFixed(4) : "-"}</span>
              <span>test_{finalMetricName}: {typeof scoreObj?.test === "number" ? scoreObj.test.toFixed(4) : "-"}</span>
            </div>
          ))}
        </div>
      </details>

      <details style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "10px 12px" }} open>
        <summary style={{ cursor: "pointer", fontWeight: 600, color: "#111827" }}>Final Chosen Model Metrics ({finalModelName})</summary>
        <div style={{ marginTop: "10px" }}>
          <p><strong>Final Chosen Model:</strong> {finalModelName}</p>
          <p><strong>Selection Version:</strong> {selectedVersion}</p>
          {Object.entries(dev3.final_metrics || {}).map(([k, v]) => (
            <p key={k}>
              <strong>{k}:</strong> {typeof v === "number" ? v.toFixed(4) : String(v)}
            </p>
          ))}
          {!Object.keys(dev3.final_metrics || {}).length && (
            <p>No final chosen model metrics available.</p>
          )}
        </div>
      </details>
    </div>
  );
}

export default ModelReportAccordion;
