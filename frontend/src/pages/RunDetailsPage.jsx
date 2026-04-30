import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import api from "../api";
import MetricsCard from "../components/MetricsCard";
import ModelReportAccordion from "../components/ModelReportAccordion";
import PlotGallery from "../components/PlotGallery";
import PredictionSection from "../components/PredictionSection";
import InteractiveVisualizationBuilder from "../components/InteractiveVisualizationBuilder";
import VisualizationPanel from "../components/VisualizationPanel";
import { useRunStore } from "../store";

function RunDetailsPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { selectedRun, fetchRunById, loading, error } = useRunStore();

  useEffect(() => {
    fetchRunById(id);
  }, [id, fetchRunById]);

  const report = selectedRun?.report;
  const activeSection = searchParams.get("section") || "dashboard";
  const finalChosenModel =
    report?.dev3?.best_candidate_name ||
    (report?.dev2?.choice?.members?.length ? report.dev2.choice.members.join(", ") : "Unavailable");

  if (loading) return <p>Loading run...</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (!selectedRun) return <p>Run not found.</p>;

  const downloadFullCode = async () => {
    try {
      const response = await api.get(
        `/runs/${selectedRun._id}/download-training-script`,
        { responseType: "blob" }
      );
      const contentType = response.headers["content-type"] || "text/x-python";
      const disposition = response.headers["content-disposition"] || "";
      const fileNameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const fileName = fileNameMatch?.[1] || "tailored_pipeline.py";
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
      // Keep UI minimal; native alert is enough for this one action.
      alert(err.response?.data?.message || "Download failed.");
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

  return (
    <div className="run-details-content">
      {activeSection === "dashboard" && (
        <>
          <section className="panel">
            <h2>{selectedRun.datasetFilename}</h2>
            <p>Target: {selectedRun.targetCol}</p>
            <p>Status: <strong>{selectedRun.status}</strong></p>
            <p>Final Chosen Model: <strong>{finalChosenModel}</strong></p>
          </section>
          <MetricsCard title="Final Metrics" metrics={report?.dev3?.final_metrics} />
          <ModelReportAccordion report={report} />
          <div className="panel">
            <h2>Raw Report JSON</h2>
            <pre className="code-block">{JSON.stringify(report || {}, null, 2)}</pre>
          </div>
        </>
      )}

      {activeSection === "downloads" && (
        <section className="panel">
          <h2>Downloads</h2>
          <div className="viz-mode-row">
            <button className="secondary-btn" onClick={downloadReportJson}>
              Download JSON
            </button>
            <button className="secondary-btn" onClick={downloadFullCode}>
              Download Code
            </button>
          </div>
        </section>
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
