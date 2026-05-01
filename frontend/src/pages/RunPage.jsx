import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RunForm from "../components/RunForm";
import { useRunStore } from "../store";

function RunPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { executeRun, loading, error, runProgress } = useRunStore();

  const handleRun = async (payload) => {
    const data = await executeRun(payload);
    navigate(`/history/${data._id}`);
  };

  return (
    <div className="grid-one run-page-grid">
      <h2>{t("run.title")}</h2>
      <RunForm onSubmit={handleRun} loading={loading} error={error} runProgress={runProgress} />
    </div>
  );
}

export default RunPage;
