import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiFolder, FiPlus, FiTrash2 } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { useFrontendDialogs } from "../components/FrontendDialogs";
import { useRunStore } from "../store";
import { runVisibleOnProjectsPage } from "../utils/runVisibility";

const HISTORY_NAMES_KEY = "history_project_names";

function ProjectsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { runs, fetchRuns, loading, error, deleteRun } = useRunStore();
  const { confirm, alert: alertDialog } = useFrontendDialogs();
  const [query, setQuery] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showTopFog, setShowTopFog] = useState(false);
  const [showBottomFog, setShowBottomFog] = useState(false);
  const scrollRef = useRef(null);
  const [deletingId, setDeletingId] = useState(null);

  const [projectNames, setProjectNames] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_NAMES_KEY) || "{}");
    } catch {
      return {};
    }
  });

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onVoiceSearch = (event) => {
      setQuery(event.detail?.query || "");
    };
    window.addEventListener("voice-search-projects", onVoiceSearch);
    return () => window.removeEventListener("voice-search-projects", onVoiceSearch);
  }, []);

  const projectCards = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return runs
      .filter((run) => runVisibleOnProjectsPage(run))
      .map((run) => {
        const projectName = projectNames[run._id] || run.projectName || run.datasetFilename || "Untitled";
        const datasetName = run.datasetFilename || "-";
        return {
          id: run._id,
          projectName,
          datasetName,
          createdAt: run.createdAt,
        };
      })
      .filter((item) => {
        if (!normalized) return true;
        return (
          item.projectName.toLowerCase().includes(normalized) ||
          item.datasetName.toLowerCase().includes(normalized)
        );
      });
  }, [runs, projectNames, query]);

  useEffect(() => {
    const updateFog = () => {
      const el = scrollRef.current;
      if (!el) return;
      const hasTop = el.scrollTop > 2;
      const hasBottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      setShowTopFog(hasTop);
      setShowBottomFog(hasBottom);
    };

    updateFog();
    window.addEventListener("resize", updateFog);
    return () => window.removeEventListener("resize", updateFog);
  }, [projectCards.length, loading, query]);

  const onDeleteProject = async (e, runId) => {
    e.preventDefault();
    e.stopPropagation();
    const label =
      projectNames[runId] || runs.find((r) => r._id === runId)?.projectName || runs.find((r) => r._id === runId)?.datasetFilename || "this project";
    const agreed = await confirm({
      title: t("projects.deleteTitle"),
      message: t("projects.deleteConfirm", { name: label }),
      confirmText: t("dialogs.delete"),
      cancelText: t("dialogs.cancel"),
    });
    if (!agreed) return;
    setDeletingId(runId);
    try {
      await deleteRun(runId);
      setProjectNames((prev) => {
        const next = { ...prev };
        delete next[runId];
        try {
          localStorage.setItem(HISTORY_NAMES_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    } catch {
      await alertDialog(t("projects.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        height: "100%",
        minHeight: 0,
        padding: isMobile ? "8px 12px 20px" : "12px 8px 24px",
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      <style>
        {`
          .project-search-input:focus {
            border-color: #111827;
            box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.08);
          }
          .project-create-btn:hover {
            background: #222222;
          }
          .project-create-btn:active {
            background: #000000;
            transform: translateY(1px);
          }
          .projects-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
            gap: clamp(18px, 2.5vw, 26px);
            row-gap: clamp(18px, 2.8vw, 28px);
            align-content: start;
            justify-items: stretch;
            width: 100%;
            box-sizing: border-box;
          }
          article.project-card {
            position: relative;
            box-sizing: border-box;
            min-width: 0;
            isolation: isolate;
          }
          article.project-card .project-delete-btn {
            position: absolute;
            top: 12px;
            right: 12px;
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transition:
              opacity 0.18s ease,
              visibility 0.18s ease,
              background-color 0.15s ease;
            z-index: 2;
          }
          article.project-card:hover .project-delete-btn,
          article.project-card:focus-within .project-delete-btn {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
          }
          article.project-card[data-deleting="true"] .project-delete-btn {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
          }
          @media (hover: none) {
            article.project-card .project-delete-btn {
              opacity: 1;
              visibility: visible;
              pointer-events: auto;
            }
          }
          article.project-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.1);
            border-color: #d1d5db;
            z-index: 1;
          }
          article.project-card:active {
            transform: translateY(0);
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
            z-index: 0;
          }
          @keyframes project-skeleton-shimmer {
            0% {
              background-position: -220px 0;
            }
            100% {
              background-position: calc(220px + 100%) 0;
            }
          }
          .project-skeleton-line {
            border-radius: 10px;
            background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 37%, #f3f4f6 63%);
            background-size: 420px 100%;
            animation: project-skeleton-shimmer 1.2s ease-in-out infinite;
          }
        `}
      </style>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: "12px 16px",
          width: "100%",
          alignItems: "center",
          boxSizing: "border-box",
        }}
      >
        <input
          className="project-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("projects.searchPlaceholder")}
          style={{
            width: "auto",
            flex: 1,
            minWidth: 0,
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "12px 14px",
            fontSize: "0.98rem",
            outline: "none",
            transition: "all 0.2s ease",
            background: "#ffffff",
          }}
        />
        <button
          type="button"
          className="project-create-btn"
          onClick={() => navigate("/app")}
          style={{
            width: isMobile ? "auto" : "20%",
            minWidth: "120px",
            border: "none",
            borderRadius: "12px",
            padding: "12px 18px",
            minHeight: "44px",
            background: "#111111",
            color: "#ffffff",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            alignSelf: "auto",
            marginLeft: "auto",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          <FiPlus />
          {t("projects.create")}
        </button>
      </div>

      <div
        style={{
          position: "relative",
          minHeight: 0,
          flex: 1,
        }}
      >
        <div
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current;
            if (!el) return;
            const hasTop = el.scrollTop > 2;
            const hasBottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
            setShowTopFog(hasTop);
            setShowBottomFog(hasBottom);
          }}
          style={{
            overflowY: "auto",
            minHeight: 0,
            height: "100%",
            paddingRight: "10px",
            paddingBottom: "8px",
            boxSizing: "border-box",
          }}
        >
          {error && <p style={{ color: "#b91c1c", margin: "0 0 12px" }}>{error}</p>}
          <div className="projects-grid" style={{ paddingTop: "4px" }}>
            {loading &&
              projectCards.length === 0 &&
              Array.from({ length: 8 }).map((_, index) => (
                <article
                  key={`skeleton-${index}`}
                  style={{
                    border: "1px solid #e5e7eb",
                    background: "#ffffff",
                    borderRadius: "14px",
                    padding: "16px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    minWidth: 0,
                  }}
                >
                  <div className="project-skeleton-line" style={{ height: "22px", width: "68%" }} />
                  <div className="project-skeleton-line" style={{ height: "16px", width: "92%" }} />
                  <div className="project-skeleton-line" style={{ height: "14px", width: "42%" }} />
                </article>
              ))}
            {projectCards.map((project) => (
              <article
                key={project.id}
                className="project-card"
                data-deleting={deletingId === project.id ? "true" : undefined}
                style={{
                  textAlign: "left",
                  border: "1px solid #e5e7eb",
                  background: "#ffffff",
                  borderRadius: "14px",
                  padding: "16px 14px",
                  transition: "box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease",
                  display: "block",
                  width: "100%",
                  minWidth: 0,
                }}
              >
                <button
                  type="button"
                  onClick={() => navigate(`/history/${project.id}`)}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    margin: 0,
                    padding: "2px 52px 2px 2px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    boxSizing: "border-box",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontWeight: 700,
                      fontSize: "1.04rem",
                      color: "#111827",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                    }}
                  >
                    {project.projectName}
                  </p>
                  <p style={{ margin: 0, color: "#4b5563", overflowWrap: "anywhere" }}>{project.datasetName}</p>
                  <p style={{ margin: 0, color: "#6b7280", fontSize: "0.92rem" }}>
                    {new Date(project.createdAt).toLocaleDateString()}
                  </p>
                </button>
                <button
                  type="button"
                  className="project-delete-btn"
                  title={t("projects.deleteTitle")}
                  aria-label={t("projects.deleteTitle")}
                  disabled={deletingId === project.id}
                  onClick={(e) => onDeleteProject(e, project.id)}
                  style={{
                    width: "40px",
                    height: "40px",
                    border: "1px solid #fecaca",
                    borderRadius: "10px",
                    background: deletingId === project.id ? "#f3f4f6" : "#fef2f2",
                    color: "#b91c1c",
                    cursor: deletingId === project.id ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <FiTrash2 size={18} aria-hidden />
                </button>
              </article>
            ))}
            {!loading && projectCards.length === 0 && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  border: "1px solid #e5e7eb",
                  background: "#ffffff",
                  borderRadius: "14px",
                  padding: "30px 20px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  textAlign: "center",
                }}
              >
                <FiFolder size={28} color="#6b7280" />
                <p style={{ margin: 0, color: "#111827", fontWeight: 600 }}>{t("projects.emptyTitle")}</p>
                <p style={{ margin: 0, color: "#6b7280", fontSize: "0.95rem" }}>{t("projects.emptyHint")}</p>
                <button
                  type="button"
                  className="project-create-btn"
                  onClick={() => navigate("/app")}
                  style={{
                    marginTop: "4px",
                    minWidth: "120px",
                    border: "none",
                    borderRadius: "12px",
                    padding: "12px 18px",
                    minHeight: "44px",
                    background: "#111111",
                    color: "#ffffff",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    whiteSpace: "nowrap",
                  }}
                >
                  <FiPlus />
                  {t("projects.create")}
                </button>
              </div>
            )}
          </div>
        </div>
        <div
          aria-hidden="true"
          style={{
            pointerEvents: "none",
            position: "absolute",
            left: 0,
            right: "4px",
            top: 0,
            height: "26px",
            background: "linear-gradient(to bottom, rgba(var(--cloud-rgb),0.8), rgba(var(--cloud-rgb),0))",
            opacity: showTopFog ? 1 : 0,
            transition: "opacity 140ms ease",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            pointerEvents: "none",
            position: "absolute",
            left: 0,
            right: "4px",
            bottom: 0,
            height: "28px",
            background: "linear-gradient(to top, rgba(var(--cloud-rgb),0.8), rgba(var(--cloud-rgb),0))",
            opacity: showBottomFog ? 1 : 0,
            transition: "opacity 140ms ease",
          }}
        />
      </div>
    </section>
  );
}

export default ProjectsPage;
