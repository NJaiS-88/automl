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

  const dev2Ranked = report.dev2?.ranked_models || [];
  const lineData = dev2Ranked.map(([name, score], idx) => ({
    idx,
    model: name,
    score: Number(score),
  }));

  return (
    <div className="panel">
      <h2>Visualization Overview</h2>
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
