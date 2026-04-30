import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useRunStore } from "../store";

function HistoryPage() {
  const { runs, fetchRuns, loading, error } = useRunStore();

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  return (
    <div className="panel">
      <h2>Run History</h2>
      {loading && <p>Loading...</p>}
      {error && <p className="error-text">{error}</p>}
      <div className="history-list">
        {runs.map((run) => (
          <Link key={run._id} to={`/history/${run._id}`} className="history-item">
            <div>
              <strong>{run.datasetFilename}</strong>
              <p>Target: {run.targetCol}</p>
            </div>
            <span className={`status ${run.status}`}>{run.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default HistoryPage;
