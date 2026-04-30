import { useState } from "react";

function RunForm({ onSubmit, loading }) {
  const [file, setFile] = useState(null);
  const [targetCol, setTargetCol] = useState("");
  const [visualizations, setVisualizations] = useState("yes");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!file || !targetCol.trim()) return;
    onSubmit({ file, targetCol, visualizations });
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
      <div className="field">
        <label>Visualizations</label>
        <select value={visualizations} onChange={(e) => setVisualizations(e.target.value)}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
      <button className="primary-btn" disabled={loading}>
        {loading ? "Running..." : "Run AutoML"}
      </button>
    </form>
  );
}

export default RunForm;
