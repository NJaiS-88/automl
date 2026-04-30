import { useState } from "react";

function RunForm({ onSubmit, loading }) {
  const [file, setFile] = useState(null);
  const [targetCol, setTargetCol] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!file || !targetCol.trim()) return;
    onSubmit({ file, targetCol });
  };

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>New Training Run</h2>
      <div className="field">
        <label>Dataset (CSV)</label>
        <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </div>
      <div className="field">
        <label>Target Column</label>
        <input
          type="text"
          placeholder="e.g. Churn / species / target"
          value={targetCol}
          onChange={(e) => setTargetCol(e.target.value)}
        />
      </div>
      <button className="primary-btn" disabled={loading}>
        {loading ? "Running..." : "Run AutoML"}
      </button>
    </form>
  );
}

export default RunForm;
