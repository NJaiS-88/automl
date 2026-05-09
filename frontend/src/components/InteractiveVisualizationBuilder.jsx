import { useEffect, useMemo, useRef, useState } from "react";
import api, { BACKEND_BASE_URL } from "../api";
import { AnimatePresence, motion } from "framer-motion";
import { gsap } from "gsap";
import SilverLoader from "./SilverLoader";
import { useRunStore } from "../store";

function inferColumnType(rows, column) {
  if (!column || !rows?.length) return "unknown";
  let numericCount = 0;
  let observed = 0;
  for (const row of rows) {
    const raw = row[column];
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    observed += 1;
    const n = Number(raw);
    if (!Number.isNaN(n) && Number.isFinite(n)) numericCount += 1;
  }
  if (!observed) return "unknown";
  return numericCount / observed >= 0.7 ? "numeric" : "categorical";
}

function buildChartOptions(univariateType, xType, yType) {
  if (univariateType) {
    return univariateType === "numeric"
      ? ["histogram", "kde", "violin", "box", "line", "bar"]
      : ["bar", "pie"];
  }
  if (!xType || !yType) return [];
  if (xType === "numeric" && yType === "numeric") return ["scatter", "line", "kde"];
  if (xType === "categorical" && yType === "numeric") return ["bar", "box", "violin"];
  if (xType === "categorical" && yType === "categorical") return ["bar"];
  if (xType === "numeric" && yType === "categorical") return ["bar", "box", "violin"];
  return [];
}

function dropZoneLabel(kind) {
  if (kind === "x") return "Drop X-axis column";
  if (kind === "y") return "Drop Y-axis column";
  if (kind === "hue") return "Drop Hue column";
  if (kind === "multi") return "Drop multiple columns";
  return "Drop single column for univariate analysis";
}

function InteractiveVisualizationBuilder({ run }) {
  const fetchRunById = useRunStore((state) => state.fetchRunById);
  const containerRef = useRef(null);
  const rows = useMemo(() => run?.previewRows || [], [run]);
  const columns = useMemo(() => {
    const featureCols = run?.featureColumns || [];
    const targetCol = run?.targetCol;
    if (targetCol && !featureCols.includes(targetCol)) {
      return [...featureCols, targetCol];
    }
    return featureCols;
  }, [run]);

  const [xCol, setXCol] = useState(null);
  const [yCol, setYCol] = useState(null);
  const [singleCol, setSingleCol] = useState(null);
  const [hueCol, setHueCol] = useState(null);
  const [multivariateCols, setMultivariateCols] = useState([]);
  const [mode, setMode] = useState("univariate");
  const [selectedCharts, setSelectedCharts] = useState([]);
  const [generatedUrls, setGeneratedUrls] = useState([]);
  const [selectedGeneratedUrls, setSelectedGeneratedUrls] = useState([]);
  const [serverErrors, setServerErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const columnTypes = useMemo(() => {
    const map = {};
    for (const col of columns) map[col] = inferColumnType(rows, col);
    return map;
  }, [columns, rows]);

  const univariateType = singleCol ? columnTypes[singleCol] : null;
  const xType = xCol ? columnTypes[xCol] : null;
  const yType = yCol ? columnTypes[yCol] : null;

  const validChartOptions = useMemo(() => {
    if (mode === "multivariate") return ["correlation_heatmap", "pairplot"];
    if (mode === "univariate") return buildChartOptions(univariateType, null, null);
    return buildChartOptions(null, xType, yType);
  }, [mode, univariateType, xType, yType]);

  const normalizedSelectedCharts = selectedCharts.filter((item) => validChartOptions.includes(item));

  const chartLabel = (chartType) => {
    const labels = {
      histogram: "Histogram",
      line: "Line",
      pie: "Pie",
      scatter: "Scatter",
      bar: "Bar",
      box: "Box",
      violin: "Violin",
      kde: "KDE",
      correlation_heatmap: "Correlation Heatmap",
      pairplot: "Pairplot",
    };
    return labels[chartType] || chartType;
  };

  const onDragStart = (event, col) => {
    event.dataTransfer.setData("text/plain", col);
  };

  const onDrop = (event, kind) => {
    event.preventDefault();
    const col = event.dataTransfer.getData("text/plain");
    if (!col) return;
    if (kind === "single") setSingleCol(col);
    if (kind === "x") setXCol(col);
    if (kind === "y") setYCol(col);
    if (kind === "hue") setHueCol(col);
    if (kind === "multi") {
      setMultivariateCols((prev) =>
        prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
      );
    }
    setSelectedCharts([]);
  };

  const onDragOver = (event) => event.preventDefault();

  const clearSelections = () => {
    setXCol(null);
    setYCol(null);
    setSingleCol(null);
    setHueCol(null);
    setMultivariateCols([]);
    setSelectedCharts([]);
    setGeneratedUrls([]);
    setSelectedGeneratedUrls([]);
    setServerErrors([]);
  };

  const removeDropped = (kind, value = null) => {
    if (kind === "x") setXCol(null);
    if (kind === "y") setYCol(null);
    if (kind === "single") setSingleCol(null);
    if (kind === "hue") setHueCol(null);
    if (kind === "multi" && value) {
      setMultivariateCols((prev) => prev.filter((c) => c !== value));
    }
    setSelectedCharts([]);
    setGeneratedUrls([]);
    setServerErrors([]);
  };

  const modeDropKinds = {
    univariate: ["single", "hue"],
    bivariate: ["x", "y", "hue"],
    multivariate: ["multi", "hue"],
  };

  const toggleChart = (chartType) => {
    setSelectedCharts((prev) =>
      prev.includes(chartType)
        ? prev.filter((c) => c !== chartType)
        : [...prev, chartType]
    );
  };

  const canGenerate =
    normalizedSelectedCharts.length > 0 &&
    ((mode === "univariate" && !!singleCol) ||
      (mode === "bivariate" && !!xCol && !!yCol) ||
      (mode === "multivariate" && multivariateCols.length >= 2));

  const generateVisualizations = async () => {
    if (!run?._id || !canGenerate) return;
    setLoading(true);
    setServerErrors([]);
    setGeneratedUrls([]);
    setSelectedGeneratedUrls([]);
    try {
      const payload = {
        mode,
        plotTypes: normalizedSelectedCharts,
        xCol,
        yCol,
        singleCol,
        hueCol,
        multivariateCols,
      };
      const { data } = await api.post(`/runs/${run._id}/visualize`, payload);
      setGeneratedUrls(data.plotUrls || []);
      setSelectedGeneratedUrls([]);
      setServerErrors(data.errors || []);
    } catch (err) {
      setServerErrors([err.response?.data?.message || err.message]);
    } finally {
      setLoading(false);
    }
  };

  const toggleGeneratedSelection = (url) => {
    setSelectedGeneratedUrls((prev) =>
      prev.includes(url) ? prev.filter((item) => item !== url) : [...prev, url]
    );
  };

  const saveSelectedToAllVisualizations = async () => {
    if (!run?._id || selectedGeneratedUrls.length === 0) return;
    setSaving(true);
    setServerErrors([]);
    try {
      await api.post(`/runs/${run._id}/plots/add`, { plotUrls: selectedGeneratedUrls });
      await fetchRunById(run._id);
      setSelectedGeneratedUrls([]);
    } catch (err) {
      setServerErrors([err.response?.data?.message || err.message]);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    gsap.fromTo(
      containerRef.current,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }
    );
  }, []);

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px", position: "relative" }}
    >
      <style>
        {`
          .viz-layout-grid { display:grid; grid-template-columns: 300px 1fr; gap:12px; }
          .viz-left-sidebar, .viz-right-workarea, .viz-chart-options, .viz-render-grid { border:1px solid #f1f5f9; border-radius:12px; background:#fff; padding:12px; }
          .viz-columns-scroll { max-height:280px; overflow:auto; display:grid; gap:8px; }
          .viz-col-chip { border:1px solid #e5e7eb; border-radius:10px; background:#fff; padding:8px 10px; text-align:left; cursor:grab; }
          .viz-col-type { color:#6b7280; margin-left:6px; font-size:0.82rem; }
          .viz-mode-row { display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
          .active-mode { background:#e5e7eb !important; border-color:#e5e7eb !important; }
          .viz-drop-shell { border:1px solid #f1f5f9; border-radius:10px; padding:10px; }
          .viz-drop-grid { display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
          .viz-drop-zone { border:1px dashed #cbd5e1; border-radius:10px; min-height:84px; padding:10px; background:#fff; display:grid; gap:8px; align-content:start; }
          .viz-drop-zone.filled { border-style:solid; border-color:#e5e7eb; }
          .viz-selected-chip-wrap { display:flex; flex-wrap:wrap; gap:6px; }
          .viz-selected-chip { display:inline-flex; align-items:center; gap:6px; border:1px solid #e5e7eb; border-radius:999px; padding:4px 8px; background:#fff; font-size:0.82rem; }
          .viz-chip-remove { border:none; background:transparent; cursor:pointer; color:#6b7280; }
          .viz-select-row { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; }
          .viz-select-row .secondary-btn, .viz-select-row .primary-btn, .viz-save-row .secondary-btn, .viz-mode-row .secondary-btn {
            border: none; border-radius:10px; background:#111111; color:#fff; padding:10px 12px; font-weight:600; cursor:pointer;
          }
          .viz-select-row .secondary-btn, .viz-mode-row .secondary-btn { background:#fff; color:#111827; border:1px solid #d1d5db; }
          .viz-chart-options { margin-bottom:12px; }
          .viz-options-list { display:flex; flex-wrap:wrap; gap:10px; margin-top:8px; }
          .viz-option-item { display:inline-flex; gap:6px; align-items:center; border:1px solid #e5e7eb; border-radius:999px; padding:5px 9px; }
          .viz-generated-item { border:1px solid #f1f5f9; border-radius:12px; padding:10px; background:#fff; margin-bottom:10px; }
          .viz-generated-select { display:inline-flex; gap:6px; align-items:center; margin-bottom:8px; font-size:0.9rem; }
          .plot-link { display:block; border:1px solid #f1f5f9; border-radius:10px; overflow:hidden; }
          .plot-image { width:100%; height:auto; display:block; }
          .viz-helper-text { color:#6b7280; }
          @media (max-width: 900px) { .viz-layout-grid { grid-template-columns: 1fr; } }
        `}
      </style>
      <h2>Interactive Visualization Builder</h2>
      <p className="viz-helper-text">
        Drag/drop only: assign columns to Univariate, X/Y, Hue, or Multivariate columns. Charts are generated in Python (matplotlib/seaborn/pandas).
      </p>
      {!columns.length || !rows.length ? (
        <p>No preview data available for interactive plots.</p>
      ) : (
        <>
          <div className="viz-layout-grid">
            <aside className="viz-left-sidebar">
              <h3>All Columns</h3>
              <div className="viz-columns-scroll">
                {columns.map((col) => (
                  <button
                    key={col}
                    type="button"
                    draggable
                    className="viz-col-chip"
                    onDragStart={(e) => onDragStart(e, col)}
                  >
                    {col}
                    <span className="viz-col-type">({columnTypes[col]})</span>
                  </button>
                ))}
              </div>
            </aside>

            <div className="viz-right-workarea">
              <div className="viz-mode-row">
                {["univariate", "bivariate", "multivariate"].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`secondary-btn ${mode === m ? "active-mode" : ""}`}
                    onClick={() => {
                      setMode(m);
                      setXCol(null);
                      setYCol(null);
                      setSingleCol(null);
                      setMultivariateCols([]);
                      setSelectedCharts([]);
                      setGeneratedUrls([]);
                      setServerErrors([]);
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="viz-drop-shell">
                <div className="viz-drop-grid">
                {(modeDropKinds[mode] || []).map((kind) => {
                  const selected =
                    kind === "x"
                      ? xCol
                      : kind === "y"
                        ? yCol
                        : kind === "hue"
                          ? hueCol
                          : kind === "multi"
                            ? multivariateCols.length
                              ? multivariateCols.join(", ")
                              : ""
                            : singleCol;
                  return (
                    <div
                      key={kind}
                      className={`viz-drop-zone ${selected ? "filled" : ""}`}
                      onDrop={(e) => onDrop(e, kind)}
                      onDragOver={onDragOver}
                    >
                      <strong>
                        {kind === "single"
                          ? "Univariate"
                          : kind === "multi"
                            ? "Multivariate Columns"
                            : `${kind.toUpperCase()} Axis`}
                      </strong>
                      <div>
                    {kind === "multi" ? (
                      multivariateCols.length ? (
                        <div className="viz-selected-chip-wrap">
                          {multivariateCols.map((col) => (
                            <span key={col} className="viz-selected-chip">
                              {col}
                              <button
                                type="button"
                                className="viz-chip-remove"
                                onClick={() => removeDropped("multi", col)}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        "Drop multiple columns"
                      )
                    ) : kind === "hue" ? (
                      hueCol ? (
                        <span className="viz-selected-chip">
                          {hueCol}
                          <button
                            type="button"
                            className="viz-chip-remove"
                            onClick={() => removeDropped("hue")}
                          >
                            ×
                          </button>
                        </span>
                      ) : (
                        "Drop Hue column (optional)"
                      )
                    ) : selected ? (
                      <span className="viz-selected-chip">
                        {selected}
                        <button
                          type="button"
                          className="viz-chip-remove"
                          onClick={() => removeDropped(kind)}
                        >
                          ×
                        </button>
                      </span>
                    ) : (
                      dropZoneLabel(kind)
                    )}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            </div>
          </div>

          <div className="viz-select-row">
            <button type="button" className="secondary-btn" onClick={clearSelections}>
              Reset Column Selection
            </button>
            <button
              type="button"
              className="primary-btn"
              disabled={loading || !canGenerate}
              onClick={generateVisualizations}
            >
              {loading ? "Generating..." : "Generate Visualizations"}
            </button>
          </div>

          <div className="viz-chart-options">
            <strong>Available chart types:</strong>
            {!validChartOptions.length ? (
              <p className="viz-helper-text">
                Select valid column combinations first.
              </p>
            ) : (
              <div className="viz-options-list">
                {validChartOptions.map((option) => (
                  <label key={option} className="viz-option-item">
                    <input
                      type="checkbox"
                      checked={normalizedSelectedCharts.includes(option)}
                      onChange={() => toggleChart(option)}
                    />
                    {chartLabel(option)}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="viz-render-grid">
            {serverErrors.length > 0 && (
              <div className="error-text">
                {serverErrors.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            )}
            {generatedUrls.length > 0 && (
              <div className="viz-save-row">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={saving || selectedGeneratedUrls.length === 0}
                  onClick={saveSelectedToAllVisualizations}
                >
                  {saving
                    ? "Saving..."
                    : `Add Selected to All Visualizations (${selectedGeneratedUrls.length})`}
                </button>
              </div>
            )}
            <AnimatePresence>
            {generatedUrls.map((url) => (
              <motion.div
                key={url}
                className="viz-generated-item"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                <label className="viz-generated-select">
                  <input
                    type="checkbox"
                    checked={selectedGeneratedUrls.includes(url)}
                    onChange={() => toggleGeneratedSelection(url)}
                  />
                  Select
                </label>
                <a
                  className="plot-link"
                  href={`${BACKEND_BASE_URL}${url}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    className="plot-image"
                    src={`${BACKEND_BASE_URL}${url}`}
                    alt="python-generated-plot"
                    loading="lazy"
                  />
                </a>
              </motion.div>
            ))}
            </AnimatePresence>
          </div>
        </>
      )}
      {loading && (
        <div className="content-overlay silver">
          <div className="overlay-content loading-overlay-content">
            <SilverLoader text="Generating visualizations with a silver glow..." />
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default InteractiveVisualizationBuilder;
