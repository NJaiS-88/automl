import { useEffect } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import MetricsCard from "../components/MetricsCard";
import ModelReportAccordion from "../components/ModelReportAccordion";
import PlotGallery from "../components/PlotGallery";
import PredictionSection from "../components/PredictionSection";
import VisualizationPanel from "../components/VisualizationPanel";
import { useRunStore } from "../store";

function RunDetailsPage() {
  const { id } = useParams();
  const { selectedRun, fetchRunById, loading, error } = useRunStore();

  useEffect(() => {
    fetchRunById(id);
  }, [id, fetchRunById]);

  const report = selectedRun?.report;

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

  return (
    <div className="grid-two">
      <div>
        <div className="panel">
          <h2>{selectedRun.datasetFilename}</h2>
          <p>Target: {selectedRun.targetCol}</p>
          <p>Status: <strong>{selectedRun.status}</strong></p>
          <button className="secondary-btn inline" onClick={downloadFullCode}>
            Download Python Training Script
          </button>
        </div>

        <MetricsCard title="Dev2 Baseline Metrics" metrics={report?.dev2?.baseline_metrics} />
        <MetricsCard title="Dev3 Final Metrics" metrics={report?.dev3?.final_metrics} />
        <VisualizationPanel report={report} />
        <ModelReportAccordion report={report} />
      </div>
      <div>
        <PredictionSection run={selectedRun} />
        <div className="panel">
          <h2>Raw Report JSON</h2>
          <pre className="code-block">{JSON.stringify(report || {}, null, 2)}</pre>
        </div>
      </div>
      <div className="full-span">
        <PlotGallery plotUrls={selectedRun.plotUrls || []} />
      </div>
    </div>
  );
}

export default RunDetailsPage;
