import { useNavigate } from "react-router-dom";
import { FiActivity, FiArrowLeft, FiBarChart2, FiCpu, FiDatabase, FiLoader } from "react-icons/fi";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import RunForm from "../components/RunForm";
import { useFrontendDialogs } from "../components/FrontendDialogs";
import { useRunStore } from "../store";

const HISTORY_NAMES_KEY = "history_project_names";
const LOADING_STEPS = [
  {
    key: "analyzing",
    title: "Analyzing dataset",
    subtitle: "Inspecting schema, data types, and missing values.",
    icon: FiDatabase,
  },
  {
    key: "preprocessing",
    title: "Preprocessing and cleaning",
    subtitle: "Handling nulls, encoding categories, and preparing features.",
    icon: FiActivity,
  },
  {
    key: "training",
    title: "Model training",
    subtitle: "Running AutoML search across strong algorithms.",
    icon: FiCpu,
  },
  {
    key: "evaluating",
    title: "Evaluating",
    subtitle: "Comparing metrics and selecting the best pipeline.",
    icon: FiBarChart2,
  },
];

function RunPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { confirm } = useFrontendDialogs();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);
  const { executeRun, loading, error, runProgress, patchRun } = useRunStore();
  const [displayStepIndex, setDisplayStepIndex] = useState(0);
  const stepTimerRef = useRef(null);
  const loadingStepIndex = useMemo(() => {
    const stage = String(runProgress?.currentStage || "").toLowerCase();
    const indexByStage = {
      analyzing: 0,
      analyze: 0,
      preprocessing: 1,
      preprocess: 1,
      cleaning: 1,
      training: 2,
      train: 2,
      model_training: 2,
      evaluating: 3,
      evaluate: 3,
      finalize: 3,
      failed: 3,
    };
    if (stage in indexByStage) return indexByStage[stage];
    if (stage.includes("preprocess") || stage.includes("clean")) return 1;
    if (stage.includes("train")) return 2;
    if (stage.includes("evaluat") || stage.includes("final")) return 3;
    return 0;
  }, [runProgress?.currentStage]);
  const currentLoadingStep = LOADING_STEPS[Math.min(loadingStepIndex, LOADING_STEPS.length - 1)];

  useEffect(() => {
    if (!loading) {
      setDisplayStepIndex(0);
      if (stepTimerRef.current) {
        clearTimeout(stepTimerRef.current);
        stepTimerRef.current = null;
      }
      return;
    }

    if (loadingStepIndex > displayStepIndex) {
      stepTimerRef.current = setTimeout(() => {
        setDisplayStepIndex((prev) => Math.min(prev + 1, loadingStepIndex));
      }, 550);
    } else if (loadingStepIndex < displayStepIndex) {
      setDisplayStepIndex(loadingStepIndex);
    }

    return () => {
      if (stepTimerRef.current) {
        clearTimeout(stepTimerRef.current);
        stepTimerRef.current = null;
      }
    };
  }, [loading, loadingStepIndex, displayStepIndex]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleRun = async (payload) => {
    try {
      const data = await executeRun(payload);
      const trimmedProjectName = payload?.projectName?.trim();
      if (trimmedProjectName) {
        try {
          const savedNames = JSON.parse(localStorage.getItem(HISTORY_NAMES_KEY) || "{}");
          localStorage.setItem(
            HISTORY_NAMES_KEY,
            JSON.stringify({ ...savedNames, [data._id]: trimmedProjectName })
          );
        } catch {
          /* keep run successful if localStorage fails */
        }
      }

      const addToProjectsList = await confirm({
        title: t("projects.addToProjectsTitle"),
        message: t("projects.addToProjectsMessage"),
        confirmText: t("projects.addToProjectsYes"),
        cancelText: t("projects.addToProjectsNo"),
      });
      if (addToProjectsList) {
        await patchRun(data._id, { showInProjects: true });
      }

      navigate(`/history/${data._id}`);
    } catch {
      /* errors surfaced via store RunForm */
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: "10px", minHeight: 0, position: "relative" }}>
      <style>
        {`
          @keyframes text-sweep {
            0% {
              background-position: -220% 0;
            }
            100% {
              background-position: 220% 0;
            }
          }
          .animated-loading-text {
            background: linear-gradient(
              90deg,
              #6b7280 0%,
              #6b7280 35%,
              #111827 50%,
              #6b7280 65%,
              #6b7280 100%
            );
            background-size: 220% 100%;
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            animation: text-sweep 1.8s linear infinite;
          }
          @keyframes overlay-spin {
            to {
              transform: rotate(360deg);
            }
          }
          .loading-step-item {
            width: min(360px, 100%);
            display: inline-flex;
            align-items: center;
            gap: 10px;
            color: #9ca3af;
            font-size: 1.05rem;
            font-weight: 500;
            line-height: 1.2;
          }
          .loading-step-item.active {
            color: #111827;
            font-weight: 700;
            opacity: 1;
          }
          .loading-step-item.dimmed {
            opacity: 0.45;
          }
        `}
      </style>
      <button
        type="button"
        onClick={() => navigate("/projects")}
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "10px",
          border: "none",
          background: "#ffffff",
          color: "#111827",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          marginLeft: isMobile ? 0 : "-4px",
        }}
        aria-label="Back to projects"
      >
        <FiArrowLeft />
      </button>
      <div style={{ flex: 1, minHeight: 0 }}>
        <RunForm onSubmit={handleRun} loading={loading} error={error} />
      </div>
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(15, 23, 42, 0.38)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 8,
            borderRadius: "12px",
            padding: "12px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "14px",
              border: "1px solid #d1d5db",
              boxShadow: "0 14px 34px rgba(15, 23, 42, 0.12)",
              padding: "18px 20px 20px",
              width: "min(620px, 100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <FiLoader
              style={{
                color: "#475569",
                fontSize: "28px",
                animation: "overlay-spin 0.9s linear infinite",
              }}
            />
            <p style={{ margin: 0, color: "#111827", fontWeight: 700, fontSize: "1.18rem", textAlign: "center" }}>
              {currentLoadingStep.title}
            </p>
            <p style={{ margin: "0 0 4px", color: "#4b5563", fontSize: "0.95rem", textAlign: "center" }}>
              {currentLoadingStep.subtitle}
            </p>
            {LOADING_STEPS.map((step, index) => {
              const isActive = index === displayStepIndex;
              const StepIcon = step.icon;
              return (
                <div key={step.key} className={`loading-step-item ${isActive ? "active" : "dimmed"}`}>
                  <StepIcon size={18} />
                  <span className={isActive ? "animated-loading-text" : ""}>{step.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default RunPage;
