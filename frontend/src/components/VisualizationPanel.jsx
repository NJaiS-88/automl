import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function VisualizationPanel({ report }) {
  if (!report) return null;

  const candidateScores = report.dev3?.candidate_scores || {};
  const lineData = Object.entries(candidateScores).map(([name, scoreObj], idx) => ({
    idx,
    model: name,
    score: Number(scoreObj?.test ?? scoreObj?.train ?? 0),
  }));

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px" }}>
      <h2 style={{ margin: "0 0 10px", color: "#111827" }}>Visualization Overview</h2>
      {!lineData.length && <p>No visualization metrics available.</p>}
      <div style={{ border: "1px solid #f1f5f9", borderRadius: "12px", padding: "10px 8px", background: "#ffffff" }}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={lineData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="model" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="score" stroke="#2563eb" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default VisualizationPanel;
