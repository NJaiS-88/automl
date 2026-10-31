import { resolveDev2BaseModelName, resolveFinalChosenModelLabel } from "../utils/runDisplay";

const SOURCE_LABELS = {
  dev2_baseline: "Dev2 choice",
  dev2_candidate: "Dev2 candidate",
  dev3_candidate: "Dev3 tuned",
  randomized_search: "Randomized search",
  calibration: "Calibrated",
  chunk_ensemble: "Chunk ensemble",
};

const fmt = (v) => (typeof v === "number" ? v.toFixed(4) : "-");

function ModelReportAccordion({ report, runStatus }) {
  if (!report) return null;
  const dev3 = report.dev3 || {};
  const leaderboard = Array.isArray(dev3.leaderboard) ? dev3.leaderboard : [];
  const candidateScores = dev3.candidate_scores || {};
  const candidateEntries = leaderboard.length
    ? leaderboard.map((row) => [`${row.name}|${row.source}`, row])
    : Object.entries(candidateScores);
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
          {leaderboard.length > 0 && dev3.selection_rule && (
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#6b7280" }}>
              Ranked by test score with a penalty for train/test gaps beyond the overfit threshold.
            </p>
          )}
          {candidateEntries.map(([key, scoreObj]) => (
            <div
              key={key}
              style={{
                border: scoreObj?.selected ? "2px solid #16a34a" : "1px solid #f1f5f9",
                borderRadius: "10px",
                padding: "8px 10px",
                display: "grid",
                gap: "4px",
              }}
            >
              <span>
                <strong>{scoreObj?.name || key}</strong>
                {scoreObj?.source && ` · ${SOURCE_LABELS[scoreObj.source] || scoreObj.source}`}
                {scoreObj?.selected && <strong style={{ color: "#16a34a" }}> · Selected</strong>}
                {scoreObj?.overfit && <span style={{ color: "#dc2626" }}> · Overfit</span>}
              </span>
              <span>train_{finalMetricName}: {fmt(scoreObj?.train)}</span>
              <span>test_{finalMetricName}: {fmt(scoreObj?.test)}</span>
              {typeof scoreObj?.gap === "number" && (
                <span>
                  gap: {fmt(scoreObj.gap)} · selection score: {fmt(scoreObj.selection_score)}
                </span>
              )}
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
