function ModelReportAccordion({ report }) {
  if (!report) return null;
  const ranked = report.dev2?.ranked_models || [];
  const candidateScores = report.dev3?.candidate_scores || {};

  return (
    <div className="panel">
      <h2>Model Reports</h2>
      {ranked.map(([modelName, score]) => (
        <details key={modelName} className="details-card">
          <summary>
            {modelName} <span>{score?.toFixed ? score.toFixed(4) : score}</span>
          </summary>
          <div className="details-body">
            <p><strong>Model Score:</strong> {String(score)}</p>
            <p>
              <strong>Final Candidate:</strong>{" "}
              {candidateScores[modelName]
                ? `train=${candidateScores[modelName].train}, test=${candidateScores[modelName].test}`
                : "Not evaluated / not selected in final optimization"}
            </p>
          </div>
        </details>
      ))}
    </div>
  );
}

export default ModelReportAccordion;
