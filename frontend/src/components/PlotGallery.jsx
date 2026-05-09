import { BACKEND_BASE_URL } from "../api";

function PlotGallery({ plotUrls = [] }) {
  if (!plotUrls.length) {
    return (
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px" }}>
        <h2 style={{ margin: "0 0 10px", color: "#111827" }}>All Visualizations</h2>
        <p>No saved plots found for this run.</p>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px" }}>
      <h2 style={{ margin: "0 0 10px", color: "#111827" }}>All Visualizations</h2>
      <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {plotUrls.map((url, idx) => (
          <a
            key={url}
            style={{ display: "block", border: "1px solid #f1f5f9", borderRadius: "12px", overflow: "hidden", background: "#ffffff" }}
            href={`${BACKEND_BASE_URL}${url}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              style={{ width: "100%", height: "auto", display: "block" }}
              src={`${BACKEND_BASE_URL}${url}`}
              alt={`plot-${idx + 1}`}
              loading="lazy"
            />
          </a>
        ))}
      </div>
    </div>
  );
}

export default PlotGallery;
