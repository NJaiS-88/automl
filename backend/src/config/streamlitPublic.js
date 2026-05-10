/** Public URL for the Streamlit reverse proxy (must match --server.baseUrlPath). */
const STREAMLIT_PUBLIC_MOUNT = (
  process.env.STREAMLIT_PUBLIC_MOUNT || "streamlit-app"
).replace(/^\/+|\/+$/g, "");

function getBackendPublicOrigin() {
  const explicit = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (explicit) return String(explicit).replace(/\/$/, "");
  const port = process.env.PORT || 4000;
  return `http://localhost:${port}`;
}

function getStreamlitPublicUrl() {
  const base = getBackendPublicOrigin();
  return `${base}/${STREAMLIT_PUBLIC_MOUNT}/`;
}

module.exports = {
  STREAMLIT_PUBLIC_MOUNT,
  getBackendPublicOrigin,
  getStreamlitPublicUrl,
};
