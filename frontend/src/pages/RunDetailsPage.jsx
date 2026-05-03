import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import api from "../api";
import MetricsCard from "../components/MetricsCard";
import ModelReportAccordion from "../components/ModelReportAccordion";
import PlotGallery from "../components/PlotGallery";
import PredictionSection from "../components/PredictionSection";
import InteractiveVisualizationBuilder from "../components/InteractiveVisualizationBuilder";
import VisualizationPanel from "../components/VisualizationPanel";
import SilverLoader from "../components/SilverLoader";
import { useRunStore } from "../store";

function RunDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeSection = searchParams.get("section") || "dashboard";
  const { selectedRun, fetchRunById, loading, error } = useRunStore();
  const [streamlitUrl, setStreamlitUrl] = useState(null);
  const [streamlitDeps, setStreamlitDeps] = useState(null);

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

  const report = selectedRun?.report;
  const dev2Choice = report?.dev2?.choice || {};
  const dev2SelectedModel =
    dev2Choice.type === "ensemble"
      ? `Ensemble (${(dev2Choice.members || []).join(", ")})`
      : (dev2Choice.members || [])[0] || "Unavailable";
  const finalChosenModel =
    report?.dev3?.selected_model_version === "improved"
      ? report?.dev3?.best_candidate_name || dev2SelectedModel
      : dev2SelectedModel;

  if (loading) return <SilverLoader text="Loading run insights..." />;
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
      alert(err.response?.data?.message || "Download failed.");
    }
  };

  const runStreamlitApp = async () => {
    if (selectedRun.status !== "completed") {
      alert("This run is not completed yet. Wait for training to finish.");
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
        alert(data?.message || "Streamlit start returned no URL.");
      }
    } catch (err) {
      const d = err.response?.data;
      const parts = [d?.message, d?.installCommand && `Install command:\n${d.installCommand}`].filter(Boolean);
      alert(parts.join("\n\n") || "Could not start Streamlit.");
    }
  };

  const copyStreamlitUrl = async () => {
    if (!streamlitUrl) return;
    try {
      await navigator.clipboard.writeText(streamlitUrl);
      alert("URL copied. Paste it into Chrome or Edge.");
    } catch {
      alert(`Copy manually: ${streamlitUrl}`);
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
      alert("Unable to download report JSON.");
    }
  };

  const runActionButtons = (
    <div className="run-dashboard-actions" role="group" aria-label="Downloads and Streamlit">
      <button type="button" className="secondary-btn" onClick={downloadReportJson}>
        Download JSON
      </button>
      <button type="button" className="secondary-btn" onClick={() => downloadTrainingBlob("py")}>
        Download .py
      </button>
      <button type="button" className="secondary-btn" onClick={() => downloadTrainingBlob("ipynb")}>
        Download .ipynb
      </button>
      <button
        type="button"
        className="secondary-btn"
        onClick={runStreamlitApp}
        disabled={selectedRun.status !== "completed"}
        title={
          selectedRun.status !== "completed"
            ? "Finish training for this run before opening Streamlit."
            : "Opens prediction UI using this run’s saved model."
        }
      >
        Run Streamlit app
      </button>
    </div>
  );

  return (
    <div className="run-details-content">
      {activeSection === "dashboard" && (
        <>
          <section className="panel run-dashboard-hero">
            <div className="run-dashboard-toolbar">
              <div className="run-dashboard-toolbar-text">
                <h2 className="run-dashboard-title">{selectedRun.datasetFilename}</h2>
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
              <div className="run-dashboard-streamlit-alert" role="alert">
                <strong>Python / Streamlit not ready.</strong> {streamlitDeps.message || ""}
                {streamlitDeps.installCommand ? (
                  <pre className="run-dashboard-streamlit-pre">{streamlitDeps.installCommand}</pre>
                ) : null}
              </div>
            ) : null}
            {streamlitUrl ? (
              <div className="run-dashboard-streamlit-running">
                <span className="run-dashboard-streamlit-label">Streamlit:</span>{" "}
                <a href={streamlitUrl} target="_blank" rel="noopener noreferrer">
                  {streamlitUrl}
                </a>
                <button type="button" className="secondary-btn run-dashboard-copy-url" onClick={copyStreamlitUrl}>
                  Copy URL
                </button>
              </div>
            ) : null}
          </section>
          <MetricsCard title="Final Metrics" metrics={report?.dev3?.final_metrics} />
          <ModelReportAccordion report={report} />
          <div className="panel">
            <h2>Raw Report JSON</h2>
            <pre className="code-block">{JSON.stringify(report || {}, null, 2)}</pre>
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
    </div>
  );
}

export default RunDetailsPage;
