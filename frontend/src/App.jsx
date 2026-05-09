import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiBarChart2, FiCpu, FiGrid, FiHome, FiSettings } from "react-icons/fi";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "./authStore";
import i18n from "./i18n";
import { useUiStore } from "./uiStore";
import HistoryPage from "./pages/HistoryPage";
import AuthPage from "./pages/AuthPage";
import ProjectsPage from "./pages/ProjectsPage";
import SettingsPage from "./pages/SettingsPage";
import RunDetailsPage from "./pages/RunDetailsPage";
import RunPage from "./pages/RunPage";
import VoiceAssistantButton from "./components/VoiceAssistantButton";

function App() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { theme, language } = useUiStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);
  const isAuthPath = location.pathname === "/auth";
  const isProjectDetailsPage = /^\/history\/[^/]+$/.test(location.pathname);
  const currentProjectSection = new URLSearchParams(location.search).get("section") || "dashboard";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyMargin = document.body.style.margin;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflowX = "hidden";
    document.body.style.overflowX = "hidden";
    document.body.style.margin = "0";

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.margin = previousBodyMargin;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<Navigate to="/auth" replace />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        height: "100vh",
        overflow: "hidden",
        overflowX: "hidden",
        background: "#ffffff",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <style>
        {`
          :root {
            --cloud-rgb: 255, 255, 255;
            --dark-border: #374151;
          }
          * {
            border-color: #9ca3af;
          }
          * {
            scrollbar-width: thin;
            scrollbar-color: #cbd5e1 transparent;
          }
          *::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          *::-webkit-scrollbar-track {
            background: transparent;
          }
          *::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 999px;
          }
          *::-webkit-scrollbar-thumb:hover {
            background: #94a3b8;
          }
          .sidebar-nav-item:hover {
            background: #f3f4f6;
          }
          .sidebar-nav-item:active {
            background: #e5e7eb;
          }
          [data-theme="dark"] body,
          [data-theme="dark"] #root {
            background: #000000 !important;
            color: #f8fafc !important;
          }
          [data-theme="dark"] {
            --cloud-rgb: 0, 0, 0;
          }
          [data-theme="dark"] #root,
          [data-theme="dark"] #root * {
            background-color: #000000 !important;
            color: #f8fafc !important;
          }
          [data-theme="dark"] a {
            color: #cbd5e1 !important;
          }
          [data-theme="dark"] div[style*="background: #ffffff"],
          [data-theme="dark"] section[style*="background: #ffffff"],
          [data-theme="dark"] article[style*="background: #ffffff"],
          [data-theme="dark"] form[style*="background: #ffffff"] {
            background: #000000 !important;
            border-color: var(--dark-border) !important;
          }
          [data-theme="dark"] input,
          [data-theme="dark"] select,
          [data-theme="dark"] textarea {
            background: #000000 !important;
            color: #f8fafc !important;
            border-color: var(--dark-border) !important;
          }
          [data-theme="dark"] input::placeholder,
          [data-theme="dark"] textarea::placeholder {
            color: #94a3b8 !important;
          }
          [data-theme="dark"] button {
            border-color: var(--dark-border) !important;
          }
          /* white buttons become dark */
          [data-theme="dark"] button[style*="background: #ffffff"],
          [data-theme="dark"] button[style*="background:#ffffff"] {
            background: #000000 !important;
            color: #f8fafc !important;
          }
          /* black buttons become lighter dark gray */
          [data-theme="dark"] button[style*="background: #111111"],
          [data-theme="dark"] button[style*="background:#111111"] {
            background: #374151 !important;
            color: #f8fafc !important;
          }
          [data-theme="dark"] button[style*="background: #1f2937"],
          [data-theme="dark"] button[style*="background:#1f2937"] {
            background: #374151 !important;
            color: #f8fafc !important;
          }
          /* blue buttons become dark blue-black */
          [data-theme="dark"] button[style*="background: #2563eb"],
          [data-theme="dark"] button[style*="background:#2563eb"] {
            background: #1e3a8a !important;
            color: #e2e8f0 !important;
          }
          [data-theme="dark"] button[style*="background: transparent"],
          [data-theme="dark"] button[style*="background:transparent"] {
            background: #000000 !important;
          }
          [data-theme="dark"] pre[style*="background: #ffffff"],
          [data-theme="dark"] pre[style*="background:#ffffff"] {
            background: #000000 !important;
            color: #e2e8f0 !important;
            border-color: var(--dark-border) !important;
          }
          [data-theme="dark"] #root * {
            border-color: var(--dark-border) !important;
          }
          @media (max-width: 900px) {
            * {
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            *::-webkit-scrollbar {
              display: none;
            }
          }
        `}
      </style>
      <aside
        style={{
          width: isMobile ? "100%" : "280px",
          minWidth: isMobile ? "100%" : "240px",
          maxWidth: isMobile ? "100%" : "420px",
          background: "#ffffff",
          borderRight: isMobile ? "none" : "1px solid #e5e7eb",
          borderBottom: isMobile ? "1px solid #e5e7eb" : "none",
          padding: isMobile ? "10px 12px" : "20px 14px",
          display: "flex",
          flexDirection: isMobile ? "row" : "column",
          alignItems: isMobile ? "center" : "stretch",
          overflowY: isMobile ? "hidden" : "auto",
          overflowX: "hidden",
          gap: isMobile ? "10px" : "0",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "1.05rem", padding: isMobile ? "0 4px" : "4px 8px 18px", whiteSpace: "nowrap" }}>{t("app.brand")}</div>
        <nav style={{ display: "flex", flexDirection: isMobile ? "row" : "column", gap: "10px", flex: isMobile ? "1" : "unset" }}>
          {!isProjectDetailsPage && (
            <NavLink
              to="/projects"
              className="sidebar-nav-item"
              style={({ isActive }) => ({
                textDecoration: "none",
                color: "#111827",
                borderRadius: "12px",
                padding: isMobile ? "10px 12px" : "14px 12px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                background: isActive ? "#e5e7eb" : "#ffffff",
                border: isActive ? "1px solid #e5e7eb" : "1px solid transparent",
                transition: "background-color 0.15s ease",
              })}
            >
              <FiGrid size={18} />
              {t("app.projects")}
            </NavLink>
          )}
          {isProjectDetailsPage && (
            <>
              <button
                type="button"
                className="sidebar-nav-item"
                onClick={() => navigate(`${location.pathname}?section=dashboard`)}
                style={{
                  textDecoration: "none",
                  color: "#111827",
                  borderRadius: "12px",
                  padding: isMobile ? "10px 12px" : "14px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  background: currentProjectSection === "dashboard" ? "#e5e7eb" : "#ffffff",
                  border: currentProjectSection === "dashboard" ? "1px solid #e5e7eb" : "1px solid transparent",
                  transition: "background-color 0.15s ease",
                  cursor: "pointer",
                }}
              >
                <FiHome size={18} />
                Dashboard
              </button>
              <button
                type="button"
                className="sidebar-nav-item"
                onClick={() => navigate(`${location.pathname}?section=visualizations`)}
                style={{
                  textDecoration: "none",
                  color: "#111827",
                  borderRadius: "12px",
                  padding: isMobile ? "10px 12px" : "14px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  background: currentProjectSection === "visualizations" ? "#e5e7eb" : "#ffffff",
                  border: currentProjectSection === "visualizations" ? "1px solid #e5e7eb" : "1px solid transparent",
                  transition: "background-color 0.15s ease",
                  cursor: "pointer",
                }}
              >
                <FiBarChart2 size={18} />
                Visualizations
              </button>
              <button
                type="button"
                className="sidebar-nav-item"
                onClick={() => navigate(`${location.pathname}?section=predict`)}
                style={{
                  textDecoration: "none",
                  color: "#111827",
                  borderRadius: "12px",
                  padding: isMobile ? "10px 12px" : "14px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  background: currentProjectSection === "predict" ? "#e5e7eb" : "#ffffff",
                  border: currentProjectSection === "predict" ? "1px solid #e5e7eb" : "1px solid transparent",
                  transition: "background-color 0.15s ease",
                  cursor: "pointer",
                }}
              >
                <FiCpu size={18} />
                Predict
              </button>
            </>
          )}
          {isProjectDetailsPage ? (
            <button
              type="button"
              className="sidebar-nav-item"
              onClick={() => navigate(`${location.pathname}?section=settings`)}
              style={{
                textDecoration: "none",
                color: "#111827",
                borderRadius: "12px",
                padding: isMobile ? "10px 12px" : "14px 12px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                background: currentProjectSection === "settings" ? "#e5e7eb" : "#ffffff",
                border: currentProjectSection === "settings" ? "1px solid #e5e7eb" : "1px solid transparent",
                transition: "background-color 0.15s ease",
                cursor: "pointer",
              }}
            >
              <FiSettings size={18} />
              {t("app.openSettings")}
            </button>
          ) : (
            <NavLink
              to="/settings"
              className="sidebar-nav-item"
              style={({ isActive }) => ({
                textDecoration: "none",
                color: "#111827",
                borderRadius: "12px",
                padding: isMobile ? "10px 12px" : "14px 12px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                background: isActive ? "#e5e7eb" : "#ffffff",
                border: isActive ? "1px solid #e5e7eb" : "1px solid transparent",
                transition: "background-color 0.15s ease",
              })}
            >
              <FiSettings size={18} />
              {t("app.openSettings")}
            </NavLink>
          )}
        </nav>
        <div style={{ marginTop: isMobile ? 0 : "auto", marginLeft: isMobile ? "auto" : 0, display: "flex", flexDirection: isMobile ? "row" : "column", gap: "10px", paddingTop: isMobile ? 0 : "16px", alignItems: isMobile ? "center" : "stretch" }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "10px 12px", display: isMobile ? "none" : "block", marginLeft: isMobile ? 0 : "4px", marginRight: isMobile ? 0 : "4px" }}>
            <p style={{ margin: 0, fontWeight: 600, color: "#111827" }}>{user.name}</p>
            <div style={{ position: "relative", margin: "4px 0 10px" }}>
              <p
                style={{
                  margin: 0,
                  color: "#6b7280",
                  fontSize: "0.9rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  paddingRight: "24px",
                }}
              >
                {user.email}
              </p>
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: "28px",
                  background: "linear-gradient(to right, rgba(var(--cloud-rgb),0), rgba(var(--cloud-rgb),0.9))",
                  pointerEvents: "none",
                }}
              />
            </div>
            <button
              onClick={logout}
              style={{
                border: "1px solid #d1d5db",
                background: "#ffffff",
                borderRadius: "10px",
                padding: "8px 10px",
                cursor: "pointer",
                fontWeight: 600,
                color: "#111827",
              }}
            >
              {t("app.logout")}
            </button>
          </div>
        </div>
      </aside>
      <main style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: isMobile ? "12px" : "20px 24px 26px", minHeight: 0 }}>
        <Routes>
          <Route path="/" element={<Navigate to={isAuthPath ? "/auth" : "/projects"} replace />} />
          <Route path="/auth" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/app" element={<RunPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<RunDetailsPage />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </main>
      <VoiceAssistantButton />
    </div>
  );
}

export default App;
