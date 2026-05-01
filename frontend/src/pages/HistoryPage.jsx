import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SilverLoader from "../components/SilverLoader";
import { useRunStore } from "../store";

const HISTORY_NAMES_KEY = "history_project_names";

function HistoryPage() {
  const { t } = useTranslation();
  const { runs, fetchRuns, loading, error, renameRunProject, deleteRun, clearHistory } = useRunStore();
  const [projectNames, setProjectNames] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_NAMES_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const [saveNotice, setSaveNotice] = useState("");

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    localStorage.setItem(HISTORY_NAMES_KEY, JSON.stringify(projectNames));
  }, [projectNames]);

  const runCards = useMemo(
    () =>
      runs.map((run) => ({
        ...run,
        projectLabel: projectNames[run._id] || run.datasetFilename,
      })),
    [runs, projectNames]
  );

  const onNameChange = (id, value) => {
    setProjectNames((prev) => ({ ...prev, [id]: value }));
  };

  const onSaveName = async (runId) => {
    const candidateName = projectNames[runId];
    if (!candidateName?.trim()) return;
    try {
      await renameRunProject(runId, candidateName.trim());
      setSaveNotice(t("history.saved"));
    } catch {
      setSaveNotice(t("history.savedLocal"));
    }
    window.setTimeout(() => setSaveNotice(""), 2400);
  };

  const onDeleteRun = async (runId) => {
    await deleteRun(runId);
  };

  const onClearHistory = async () => {
    await clearHistory();
  };

  return (
    <div className="panel">
      <h2>{t("history.title")}</h2>
      <div className="run-form-actions">
        <button type="button" className="secondary-btn" onClick={onClearHistory}>
          {t("history.clearAll")}
        </button>
      </div>
      {loading && <SilverLoader text={t("history.loading")} />}
      {error && <p className="error-text">{error}</p>}
      {saveNotice && <p className="viz-helper-text">{saveNotice}</p>}
      <div className="history-grid-cards">
        {runCards.map((run) => (
          <article key={run._id} className="history-card">
            <Link to={`/history/${run._id}`} className="history-card-link">
              <strong>{run.projectLabel}</strong>
              <p>{new Date(run.createdAt).toLocaleString()}</p>
              <p>{t("history.target")}: {run.targetCol}</p>
              <span className={`status ${run.status}`}>{run.status}</span>
            </Link>
            <label className="history-name-edit">
              {t("history.projectName")}
              <input
                value={projectNames[run._id] ?? run.datasetFilename}
                onChange={(e) => onNameChange(run._id, e.target.value)}
              />
            </label>
            <div className="run-form-actions">
              <button type="button" className="secondary-btn" onClick={() => onSaveName(run._id)}>
                {t("history.saveName")}
              </button>
              <button type="button" className="secondary-btn" onClick={() => onDeleteRun(run._id)}>
                {t("history.deleteRun")}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export default HistoryPage;
