import { BACKEND_BASE_URL } from "../api";

function PlotGallery({ plotUrls = [] }) {
  if (!plotUrls.length) {
    return (
      <div className="panel">
        <h2>All Visualizations</h2>
        <p>No saved plots found for this run.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>All Visualizations</h2>
      <div className="plot-grid">
        {plotUrls.map((url, idx) => (
          <a
            key={url}
            className="plot-link"
            href={`${BACKEND_BASE_URL}${url}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              className="plot-image"
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
