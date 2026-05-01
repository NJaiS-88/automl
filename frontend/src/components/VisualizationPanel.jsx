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
    <div className="panel">
      <h2>Visualization Overview</h2>
      {!lineData.length && <p>No visualization metrics available.</p>}
      <div className="chart-wrapper">
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
