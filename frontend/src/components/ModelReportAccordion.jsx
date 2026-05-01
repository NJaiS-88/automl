function ModelReportAccordion({ report }) {
  if (!report) return null;
  const dev3 = report.dev3 || {};
  const candidateScores = dev3.candidate_scores || {};
  const candidateEntries = Object.entries(candidateScores);
  const finalMetricName = dev3.metric || "score";
  const selectedVersion = dev3.selected_model_version || "original";
  const dev2Choice = report.dev2?.choice || {};
  const dev2SelectedModel =
    dev2Choice.type === "ensemble"
      ? `Ensemble (${(dev2Choice.members || []).join(", ")})`
      : (dev2Choice.members || [])[0] || "Unavailable";
  const finalModelName =
    selectedVersion === "improved"
      ? dev3.best_candidate_name || dev2SelectedModel
      : dev2SelectedModel;

  return (
    <div className="panel">
      <h2>Model Reports</h2>
      <details className="details-card" open>
        <summary>All Models Metrics <span>{candidateEntries.length}</span></summary>
        <div className="details-body">
          {!candidateEntries.length && <p>No model metrics available.</p>}
          {candidateEntries.map(([modelName, scoreObj]) => (
            <div key={modelName} className="metric-item">
              <span><strong>{modelName}</strong></span>
              <span>train_{finalMetricName}: {typeof scoreObj?.train === "number" ? scoreObj.train.toFixed(4) : "-"}</span>
              <span>test_{finalMetricName}: {typeof scoreObj?.test === "number" ? scoreObj.test.toFixed(4) : "-"}</span>
            </div>
          ))}
        </div>
      </details>

      <details className="details-card" open>
        <summary>Final Chosen Model Metrics <span>{finalModelName}</span></summary>
        <div className="details-body">
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
