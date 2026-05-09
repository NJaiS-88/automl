import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FiArrowLeft, FiDownload } from "react-icons/fi";
import api from "../api";
import { useFrontendDialogs } from "../components/FrontendDialogs";
import MetricsCard from "../components/MetricsCard";
import ModelReportAccordion from "../components/ModelReportAccordion";
import PlotGallery from "../components/PlotGallery";
import PredictionSection from "../components/PredictionSection";
import InteractiveVisualizationBuilder from "../components/InteractiveVisualizationBuilder";
import VisualizationPanel from "../components/VisualizationPanel";
import { useRunStore } from "../store";
import SettingsPage from "./SettingsPage";
import { resolveFinalChosenModelLabel } from "../utils/runDisplay";

function RunDetailsPage() {
  const { t } = useTranslation();
  const { alert: dlgAlert } = useFrontendDialogs();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeSection = searchParams.get("section") || "dashboard";
  const { selectedRun, fetchRunById, loading, error, patchRun } = useRunStore();
  const [streamlitUrl, setStreamlitUrl] = useState(null);
  const [streamlitDeps, setStreamlitDeps] = useState(null);
  const jsonScrollRef = useRef(null);
  const [showJsonTopFade, setShowJsonTopFade] = useState(false);
  const [showJsonBottomFade, setShowJsonBottomFade] = useState(false);
  const [showJsonRightFade, setShowJsonRightFade] = useState(false);

  useEffect(() => {
    fetchRunById(id);
  }, [id, fetchRunById]);

  useEffect(() => {
    setStreamlitUrl(null);
    setStreamlitDeps(null);
  }, [id]);

  useEffect(() => {
    if (activeSection === "downloads") {
      navigate({ pathname: `/history/${id}`, search: "?section=dashboard" }, { replace: true });
    }
  }, [activeSection, id, navigate]);

  useEffect(() => {
    if (loading || activeSection !== "dashboard") return undefined;
    let cancelled = false;
    api
      .get("/streamlit/check")
      .then((res) => {
        if (!cancelled) setStreamlitDeps(res.data);
      })
      .catch(() => {
        if (!cancelled) setStreamlitDeps(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, activeSection]);

  useEffect(() => {
    const updateJsonFades = () => {
      const el = jsonScrollRef.current;
      if (!el) return;
      setShowJsonTopFade(el.scrollTop > 2);
      setShowJsonBottomFade(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
      setShowJsonRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    updateJsonFades();
    window.addEventListener("resize", updateJsonFades);
    return () => window.removeEventListener("resize", updateJsonFades);
  }, [selectedRun?.report, activeSection]);

  const report = selectedRun?.report;
  const finalChosenModel = resolveFinalChosenModelLabel(report, selectedRun?.status);

  const renderSectionSkeleton = () => {
    if (activeSection === "predict") {
      return (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px", display: "grid", gap: "12px" }}>
          <div className="run-skeleton-line" style={{ height: "24px", width: "34%" }} />
          <div className="run-skeleton-line" style={{ height: "14px", width: "58%" }} />
          <div className="run-skeleton-line" style={{ height: "120px", width: "100%" }} />
          <div className="run-skeleton-line" style={{ height: "44px", width: "170px" }} />
        </div>
      );
    }
    if (activeSection === "visualizations") {
      return (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px", display: "grid", gap: "10px" }}>
            <div className="run-skeleton-line" style={{ height: "24px", width: "40%" }} />
            <div className="run-skeleton-line" style={{ height: "280px", width: "100%" }} />
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px", display: "grid", gap: "10px" }}>
            <div className="run-skeleton-line" style={{ height: "24px", width: "46%" }} />
            <div className="run-skeleton-line" style={{ height: "160px", width: "100%" }} />
          </div>
        </div>
      );
    }
    return (
      <div style={{ display: "grid", gap: "12px" }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px", display: "grid", gap: "10px" }}>
          <div className="run-skeleton-line" style={{ height: "26px", width: "46%" }} />
          <div className="run-skeleton-line" style={{ height: "14px", width: "30%" }} />
          <div className="run-skeleton-line" style={{ height: "14px", width: "26%" }} />
          <div className="run-skeleton-line" style={{ height: "44px", width: "100%" }} />
        </div>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px", display: "grid", gap: "10px" }}>
          <div className="run-skeleton-line" style={{ height: "24px", width: "32%" }} />
          <div className="run-skeleton-line" style={{ height: "96px", width: "100%" }} />
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "4px 2px 10px" }}>
        <style>
          {`
            @keyframes run-skeleton-shimmer {
              0% { background-position: -220px 0; }
              100% { background-position: calc(220px + 100%) 0; }
            }
            .run-skeleton-line {
              border-radius: 10px;
              background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 37%, #f3f4f6 63%);
              background-size: 420px 100%;
              animation: run-skeleton-shimmer 1.2s ease-in-out infinite;
            }
          `}
        </style>
        <button
          type="button"
          onClick={() => navigate("/projects")}
          style={{
            border: "none",
            background: "#ffffff",
            color: "#111827",
            borderRadius: "10px",
            padding: "8px 10px",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontWeight: 600,
            cursor: "pointer",
            width: "fit-content",
          }}
        >
          <FiArrowLeft />
          Back to all projects
        </button>
        {renderSectionSkeleton()}
      </div>
    );
  }
  if (error) return <p className="error-text">{error}</p>;
  if (!selectedRun) return <p>Run not found.</p>;

  const downloadTrainingBlob = async (kind) => {
    const path =
      kind === "ipynb"
        ? `/runs/${selectedRun._id}/download-training-notebook`
        : `/runs/${selectedRun._id}/download-training-script`;
    try {
      const response = await api.get(path, { responseType: "blob" });
      const contentType =
        response.headers["content-type"] ||
        (kind === "ipynb" ? "application/json" : "text/x-python");
      const disposition = response.headers["content-disposition"] || "";
      const fileNameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const fallback = kind === "ipynb" ? "tailored_pipeline.ipynb" : "tailored_pipeline.py";
      const fileName = fileNameMatch?.[1] || fallback;
      const blob = new Blob([response.data], { type: contentType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      void dlgAlert(err.response?.data?.message || "Download failed.");
    }
  };

  const runStreamlitApp = async () => {
    if (selectedRun.status !== "completed") {
      void dlgAlert(t("runDetails.streamlitWait"));
      return;
    }
    setStreamlitUrl(null);
    try {
      const { data } = await api.post("/streamlit/start", { runId: selectedRun._id });
      const url = typeof data?.url === "string" ? data.url : null;
      setStreamlitUrl(url);
      try {
        const chk = await api.get("/streamlit/check");
        setStreamlitDeps(chk.data);
      } catch {
        /* ignore */
      }
      if (!url) {
        void dlgAlert(data?.message || "Streamlit start returned no URL.");
      }
    } catch (err) {
      const d = err.response?.data;
      const parts = [d?.message, d?.installCommand && `Install command:\n${d.installCommand}`].filter(Boolean);
      void dlgAlert(parts.join("\n\n") || "Could not start Streamlit.");
    }
  };

  const copyStreamlitUrl = async () => {
    if (!streamlitUrl) return;
    try {
      await navigator.clipboard.writeText(streamlitUrl);
      void dlgAlert(t("runDetails.copyUrlSuccess"));
    } catch {
      void dlgAlert(t("runDetails.copyUrlManual", { url: streamlitUrl }));
    }
  };

  const downloadReportJson = () => {
    try {
      const blob = new Blob([JSON.stringify(report || {}, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedRun.datasetFilename || "run"}-report.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      void dlgAlert(t("runDetails.reportJsonFail"));
    }
  };

  const runActionButtons = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }} role="group" aria-label="Downloads and Streamlit">
      <button type="button" onClick={() => downloadTrainingBlob("py")} style={{ border: "none", background: "#111111", color: "#ffffff", borderRadius: "10px", padding: "9px 12px", fontWeight: 600, cursor: "pointer" }}>
        Download .py
      </button>
      <button type="button" onClick={() => downloadTrainingBlob("ipynb")} style={{ border: "none", background: "#111111", color: "#ffffff", borderRadius: "10px", padding: "9px 12px", fontWeight: 600, cursor: "pointer" }}>
        Download .ipynb
      </button>
      <button
        type="button"
        onClick={runStreamlitApp}
        disabled={selectedRun.status !== "completed"}
        title={
          selectedRun.status !== "completed"
            ? "Finish training for this run before opening Streamlit."
            : "Opens prediction UI using this run’s saved model."
        }
        style={{ border: "none", background: "#2563eb", color: "#ffffff", borderRadius: "10px", padding: "9px 12px", fontWeight: 600, cursor: selectedRun.status !== "completed" ? "not-allowed" : "pointer", opacity: selectedRun.status !== "completed" ? 0.5 : 1 }}
      >
        Run Streamlit app
      </button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "4px 2px 10px" }}>
      <button
        type="button"
        onClick={() => navigate("/projects")}
        style={{
          border: "none",
          background: "#ffffff",
          color: "#111827",
          borderRadius: "10px",
          padding: "8px 10px",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          fontWeight: 600,
          cursor: "pointer",
          width: "fit-content",
        }}
      >
        <FiArrowLeft />
        Back to all projects
      </button>
      {activeSection === "dashboard" && (
        <>
          {selectedRun.showInProjects === false ? (
            <div
              role="status"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "14px",
                background: "#f9fafb",
                padding: "14px 16px",
                display: "flex",
                flexWrap: "wrap",
                gap: "12px",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <p style={{ margin: 0, color: "#374151", fontSize: "0.96rem", lineHeight: 1.45, flex: "1 1 220px" }}>
                {t("projects.notOnProjectsListBanner")}
              </p>
              <button
                type="button"
                onClick={() => patchRun(selectedRun._id, { showInProjects: true })}
                style={{
                  flexShrink: 0,
                  border: "none",
                  background: "#111111",
                  color: "#ffffff",
                  borderRadius: "12px",
                  padding: "10px 16px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: "0.95rem",
                }}
              >
                {t("projects.addToProjectsButton")}
              </button>
            </div>
          ) : null}
          <section style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: "0 0 6px", color: "#111827" }}>{selectedRun.datasetFilename}</h2>
                <p>Target: {selectedRun.targetCol}</p>
                <p>
                  Status: <strong>{selectedRun.status}</strong>
                </p>
                <p>
                  Final Chosen Model: <strong>{finalChosenModel}</strong>
                </p>
              </div>
              {runActionButtons}
            </div>
            {streamlitDeps && streamlitDeps.ok === false ? (
              <div style={{ marginTop: "10px", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "10px 12px" }} role="alert">
                <strong>Python / Streamlit not ready.</strong> {streamlitDeps.message || ""}
                {streamlitDeps.installCommand ? (
                  <pre style={{ marginTop: "8px", padding: "8px", borderRadius: "8px", background: "#f8fafc", overflowX: "auto" }}>{streamlitDeps.installCommand}</pre>
                ) : null}
              </div>
            ) : null}
            {streamlitUrl ? (
              <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                <span style={{ fontWeight: 600 }}>Streamlit:</span>{" "}
                <a href={streamlitUrl} target="_blank" rel="noopener noreferrer">
                  {streamlitUrl}
                </a>
                <button type="button" onClick={copyStreamlitUrl} style={{ border: "none", background: "#111111", color: "#ffffff", borderRadius: "10px", padding: "7px 10px", fontWeight: 600, cursor: "pointer" }}>
                  Copy URL
                </button>
              </div>
            ) : null}
          </section>
          <MetricsCard title="Final Metrics" metrics={report?.dev3?.final_metrics} />
          <ModelReportAccordion report={report} runStatus={selectedRun?.status} />
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", background: "#ffffff", padding: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <h2 style={{ margin: 0, color: "#111827" }}>Raw Report JSON</h2>
              <button
                type="button"
                onClick={downloadReportJson}
                aria-label="Download report JSON"
                title="Download JSON"
                style={{
                  border: "none",
                  background: "#111111",
                  color: "#ffffff",
                  width: "34px",
                  height: "34px",
                  borderRadius: "10px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <FiDownload size={16} />
              </button>
            </div>
            <div style={{ position: "relative" }}>
              <pre
                ref={jsonScrollRef}
                onScroll={() => {
                  const el = jsonScrollRef.current;
                  if (!el) return;
                  setShowJsonTopFade(el.scrollTop > 2);
                  setShowJsonBottomFade(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
                  setShowJsonRightFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
                }}
                style={{
                  margin: 0,
                  border: "1px solid #111827",
                  borderRadius: "10px",
                  padding: "12px",
                  background: "linear-gradient(180deg, #020617 0%, #0b1220 100%)",
                  color: "#e5e7eb",
                  height: "260px",
                  overflow: "auto",
                }}
              >
                {JSON.stringify(report || {}, null, 2)}
              </pre>
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  pointerEvents: "none",
                  left: "1px",
                  right: "1px",
                  top: "1px",
                  height: "24px",
                  borderTopLeftRadius: "10px",
                  borderTopRightRadius: "10px",
                  background: "linear-gradient(to bottom, rgba(var(--cloud-rgb),0.75), rgba(var(--cloud-rgb),0))",
                  opacity: showJsonTopFade ? 1 : 0,
                  transition: "opacity 140ms ease",
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  pointerEvents: "none",
                  left: "1px",
                  right: "1px",
                  bottom: "1px",
                  height: "24px",
                  borderBottomLeftRadius: "10px",
                  borderBottomRightRadius: "10px",
                  background: "linear-gradient(to top, rgba(var(--cloud-rgb),0.75), rgba(var(--cloud-rgb),0))",
                  opacity: showJsonBottomFade ? 1 : 0,
                  transition: "opacity 140ms ease",
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  pointerEvents: "none",
                  right: "1px",
                  top: "1px",
                  bottom: "1px",
                  width: "24px",
                  borderTopRightRadius: "10px",
                  borderBottomRightRadius: "10px",
                  background: "linear-gradient(to left, rgba(var(--cloud-rgb),0.75), rgba(var(--cloud-rgb),0))",
                  opacity: showJsonRightFade ? 1 : 0,
                  transition: "opacity 140ms ease",
                }}
              />
            </div>
          </div>
        </>
      )}

      {activeSection === "predict" && <PredictionSection run={selectedRun} />}

      {activeSection === "visualizations" && (
        <>
          <VisualizationPanel report={report} />
          <InteractiveVisualizationBuilder run={selectedRun} />
          <PlotGallery plotUrls={selectedRun.plotUrls || []} />
        </>
      )}

      {activeSection === "settings" && <SettingsPage />}
    </div>
  );
}

export default RunDetailsPage;
