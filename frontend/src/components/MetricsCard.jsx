function MetricsCard({ title, metrics }) {
  if (!metrics) return null;
  return (
    <div className="panel">
      <h3>{title}</h3>
      <div className="metrics-grid">
        {Object.entries(metrics).map(([key, value]) => (
          <div key={key} className="metric-item">
            <span>{key}</span>
            <strong>{typeof value === "number" ? value.toFixed(4) : String(value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MetricsCard;
