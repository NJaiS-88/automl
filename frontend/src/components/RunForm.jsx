import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { FiUploadCloud } from "react-icons/fi";

function RunForm({ onSubmit, loading, error }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);
  const [file, setFile] = useState(null);
  const [projectName, setProjectName] = useState("");
  const [targetCol, setTargetCol] = useState("");
  const [datasetHead, setDatasetHead] = useState({ columns: [], rows: [] });
  const [datasetStats, setDatasetStats] = useState({ rowCount: 0, columnCount: 0 });
  const previewScrollRef = useRef(null);
  const [showLeftHue, setShowLeftHue] = useState(false);
  const [showRightHue, setShowRightHue] = useState(false);

  const parseDatasetHead = async (csvFile) => {
    const text = await csvFile.text();
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
    });
    const parsedRows = Array.isArray(parsed.data) ? parsed.data : [];
    const columns = Array.isArray(parsed.meta?.fields) ? parsed.meta.fields : [];
    const rows = parsedRows.slice(0, 8);
    setDatasetHead({ columns, rows });
    setDatasetStats({ rowCount: parsedRows.length, columnCount: columns.length });
  };

  const handleFileSelected = async (nextFile) => {
    if (!nextFile) return;
    setFile(nextFile);
    setTargetCol("");
    await parseDatasetHead(nextFile);
  };

  const updateHorizontalHue = () => {
    const el = previewScrollRef.current;
    if (!el) return;
    setShowLeftHue(el.scrollLeft > 2);
    setShowRightHue(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const normalizedTarget = targetCol.trim();
    if (!file || !normalizedTarget || loading) return;
    if (datasetHead.columns.length && !datasetHead.columns.includes(normalizedTarget)) return;
    try {
      await onSubmit({ file, targetCol: normalizedTarget, projectName: projectName.trim() });
    } catch {
      // Parent store already captures and displays API errors.
    }
  };

  useEffect(() => {
    updateHorizontalHue();
    window.addEventListener("resize", updateHorizontalHue);
    return () => window.removeEventListener("resize", updateHorizontalHue);
  }, [datasetHead.columns.length, datasetHead.rows.length]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <>
      <style>
        {`
          .dataset-upload-btn:hover {
            background: #f3f4f6;
          }
          .dataset-upload-btn:active {
            background: #e5e7eb;
          }
          .analyze-btn:hover {
            background: #222222;
          }
          .analyze-btn:active {
            background: #000000;
          }
          .dataset-head-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          .dataset-head-scroll::-webkit-scrollbar {
            display: none;
          }
        `}
      </style>
      <form
        onSubmit={handleSubmit}
        style={{
          display: "grid",
          gridTemplateRows: "auto 1fr",
          gap: "16px",
          height: "100%",
          minHeight: 0,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "16px" }}>
          <section
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "16px",
              background: "#ffffff",
              padding: "18px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <h3 style={{ margin: 0, color: "#111827" }}>Upload Dataset</h3>
            <p style={{ margin: 0, color: "#6b7280" }}>Upload your CSV file to begin this project.</p>
            <label
              htmlFor="dataset-upload-input"
              className="dataset-upload-btn"
              style={{
                border: "1px dashed #cbd5e1",
                borderRadius: "14px",
                padding: "24px 18px",
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                color: "#334155",
                background: "#ffffff",
                transition: "background-color 0.15s ease",
                opacity: loading ? 0.7 : 1,
              }}
            >
              <FiUploadCloud size={30} />
              <span style={{ fontWeight: 600 }}>{file ? "Change dataset" : "Select CSV file"}</span>
              <span style={{ fontSize: "0.9rem", color: "#6b7280" }}>{file ? file.name : "No file selected"}</span>
            </label>
            <input
              id="dataset-upload-input"
              type="file"
              accept=".csv"
              onChange={(e) => handleFileSelected(e.target.files?.[0] || null)}
              disabled={loading}
              style={{ display: "none" }}
            />
          </section>

          <section>
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "16px",
                background: "#ffffff",
                padding: "18px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <h3 style={{ margin: 0, color: "#111827" }}>Project Setup</h3>
              <label style={{ display: "flex", flexDirection: "column", gap: "7px", color: "#374151", fontWeight: 500 }}>
                Project Name
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Enter project name"
                  disabled={loading}
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    outline: "none",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "7px", color: "#374151", fontWeight: 500 }}>
                Target Feature
                <select
                  value={targetCol}
                  onChange={(e) => setTargetCol(e.target.value)}
                  disabled={loading || datasetHead.columns.length === 0}
                  style={{
                    border: "1px solid #d1d5db",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    outline: "none",
                    background: "#ffffff",
                  }}
                >
                  <option value="">
                    {datasetHead.columns.length === 0 ? "Upload dataset first" : "Select target feature"}
                  </option>
                  {datasetHead.columns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="analyze-btn"
                disabled={
                  loading ||
                  !file ||
                  !targetCol.trim() ||
                  (datasetHead.columns.length > 0 && !datasetHead.columns.includes(targetCol))
                }
                style={{
                  border: "none",
                  borderRadius: "10px",
                  padding: "11px 14px",
                  background: loading ? "#1f2937" : "#111111",
                  color: "#ffffff",
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "background-color 0.15s ease",
                }}
              >
                Analyze Dataset
              </button>
              {error && <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p>}
            </div>
          </section>
        </div>

        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "16px",
            background: "#ffffff",
            padding: "16px",
            minHeight: 0,
            position: "relative",
            overflow: "hidden",
            height: isMobile ? "260px" : "100%",
          }}
        >
          {datasetHead.columns.length > 0 && (
            <p style={{ margin: "0 0 10px", color: "#6b7280", fontSize: "0.92rem" }}>
              Rows: {datasetStats.rowCount} | Columns: {datasetStats.columnCount}
            </p>
          )}
          <div style={{ position: "relative", minHeight: 0, height: "100%" }}>
              <div
                ref={previewScrollRef}
                onScroll={updateHorizontalHue}
                className="dataset-head-scroll"
                style={{
                  overflow: "auto",
                  height: "100%",
                  border: "1px solid #f1f5f9",
                  borderRadius: "10px",
                }}
              >
                {datasetHead.columns.length > 0 ? (
                  <table
                    style={{
                      minWidth: "max-content",
                      width: "100%",
                      borderCollapse: "collapse",
                      background: "#ffffff",
                    }}
                  >
                    <thead>
                      <tr>
                        {datasetHead.columns.map((col) => (
                          <th
                            key={col}
                            style={{
                              textAlign: "left",
                              padding: "10px 12px",
                              borderBottom: "1px solid #e5e7eb",
                              color: "#111827",
                              fontWeight: 600,
                              background: "#ffffff",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {datasetHead.rows.map((row, idx) => (
                        <tr key={idx}>
                          {datasetHead.columns.map((col) => (
                            <td
                              key={`${idx}-${col}`}
                              style={{
                                padding: "9px 12px",
                                borderBottom: "1px solid #f1f5f9",
                                color: "#374151",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {String(row?.[col] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#9ca3af",
                      padding: "20px",
                    }}
                  >
                    No dataset uploaded.
                  </div>
                )}
              </div>
              <div
                aria-hidden="true"
                style={{
                  pointerEvents: "none",
                  position: "absolute",
                  left: 1,
                  top: 1,
                  bottom: 1,
                  width: "22px",
                  background: "linear-gradient(to right, rgba(var(--cloud-rgb),0.8), rgba(var(--cloud-rgb),0))",
                  opacity: showLeftHue ? 1 : 0,
                  transition: "opacity 140ms ease",
                  borderTopLeftRadius: "10px",
                  borderBottomLeftRadius: "10px",
                }}
              />
              <div
                aria-hidden="true"
                style={{
                  pointerEvents: "none",
                  position: "absolute",
                  right: 1,
                  top: 1,
                  bottom: 1,
                  width: "22px",
                  background: "linear-gradient(to left, rgba(var(--cloud-rgb),0.8), rgba(var(--cloud-rgb),0))",
                  opacity: showRightHue ? 1 : 0,
                  transition: "opacity 140ms ease",
                  borderTopRightRadius: "10px",
                  borderBottomRightRadius: "10px",
                }}
              />
          </div>
        </div>
      </form>

    </>
  );
}

export default RunForm;
