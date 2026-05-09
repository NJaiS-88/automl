function MetricsCard({ title, metrics }) {
  if (!metrics) return null;
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px" }}>
      <h3 style={{ margin: "0 0 12px", color: "#111827" }}>{title}</h3>
      <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {Object.entries(metrics).map(([key, value]) => (
          <div key={key} style={{ border: "1px solid #f1f5f9", borderRadius: "12px", padding: "10px 12px", background: "#ffffff" }}>
            <span style={{ color: "#6b7280", fontSize: "0.84rem" }}>{key}</span>
            <strong style={{ display: "block", color: "#111827", marginTop: "4px" }}>
              {typeof value === "number" ? value.toFixed(4) : String(value)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MetricsCard;
