import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FiMic, FiMicOff, FiSettings } from "react-icons/fi";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import "./App.css";
import { useAuthStore } from "./authStore";
import useVoiceNavigator from "./hooks/useVoiceNavigator";
import i18n from "./i18n";
import { useUiStore } from "./uiStore";
import HistoryPage from "./pages/HistoryPage";
import AuthPage from "./pages/AuthPage";
import LandingPage from "./pages/LandingPage";
import RunDetailsPage from "./pages/RunDetailsPage";
import RunPage from "./pages/RunPage";

function App() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, changePassword, deleteAccount } = useAuthStore();
  const { theme, setTheme, toggleTheme, sidebarWidth, setSidebarWidth, language, setLanguage } =
    useUiStore();
  const [showSettings, setShowSettings] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [accountNotice, setAccountNotice] = useState("");
  const isDatasetPage = /^\/history\/[^/]+$/.test(location.pathname);
  const datasetBasePath = isDatasetPage ? location.pathname : "";
  const currentSection = new URLSearchParams(location.search).get("section") || "dashboard";
  const isAuthPath = location.pathname === "/auth";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    i18n.changeLanguage(language);
  }, [language]);

  const voiceCommands = useMemo(
    () => [
      {
        phrases: ["open history", "go history"],
        onMatch: () => navigate("/history"),
      },
      {
        phrases: ["open new run", "go new run", "go dashboard"],
        onMatch: () => navigate("/app"),
      },
      {
        phrases: ["toggle dark mode", "toggle theme"],
        onMatch: () => toggleTheme(),
      },
      {
        phrases: ["switch hindi", "language hindi"],
        onMatch: () => setLanguage("hi"),
      },
      {
        phrases: ["switch english", "language english"],
        onMatch: () => setLanguage("en"),
      },
    ],
    [navigate, toggleTheme, setLanguage]
  );

  const {
    transcript,
    listening,
    browserSupportsSpeechRecognition,
    resetTranscript,
    start,
    stop,
  } = useVoiceNavigator(voiceCommands);

  const onChangePassword = async () => {
    if (!currentPassword || !newPassword) return;
    try {
      await changePassword({ currentPassword, newPassword });
      setAccountNotice(t("app.passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
    } catch {
      setAccountNotice(t("app.passwordChangeFailed"));
    }
  };

  const onDeleteAccount = async () => {
    if (!deletePassword) return;
    try {
      await deleteAccount({ password: deletePassword });
    } catch {
      setAccountNotice(t("app.accountDeleteFailed"));
    }
  };

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <div className="app-shell" style={{ "--sidebar-width": `${sidebarWidth}px` }}>
      <aside className="sidebar">
        <div className="brand">{t("app.brand")}</div>
        <nav>
          <NavLink to="/app" end className="nav-link">
            {t("app.newRun")}
          </NavLink>
          <NavLink to="/history" className="nav-link">
            {t("app.history")}
          </NavLink>
          {isDatasetPage && (
            <>
              <p className="sidebar-subtitle">{t("app.datasetSections")}</p>
              <NavLink
                to={`${datasetBasePath}?section=dashboard`}
                className={`nav-link ${currentSection === "dashboard" ? "active" : ""}`}
              >
                {t("app.dashboard")}
              </NavLink>
              <NavLink
                to={`${datasetBasePath}?section=visualizations`}
                className={`nav-link ${currentSection === "visualizations" ? "active" : ""}`}
              >
                {t("app.visualizations")}
              </NavLink>
              <NavLink
                to={`${datasetBasePath}?section=predict`}
                className={`nav-link ${currentSection === "predict" ? "active" : ""}`}
              >
                {t("app.predict")}
              </NavLink>
              <NavLink
                to={`${datasetBasePath}?section=downloads`}
                className={`nav-link ${currentSection === "downloads" ? "active" : ""}`}
              >
                {t("app.downloads")}
              </NavLink>
              <NavLink to="/app" className="nav-link">{t("app.backToMain")}</NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-controls">
          <button type="button" className="secondary-btn" onClick={() => setShowSettings((v) => !v)}>
            <FiSettings /> {t("app.openSettings")}
          </button>
          {browserSupportsSpeechRecognition && (
            <div className="voice-row">
              <button type="button" className="secondary-btn" onClick={listening ? stop : start}>
                {listening ? <FiMicOff /> : <FiMic />} {listening ? t("app.voiceStop") : t("app.voiceStart")}
              </button>
              <button type="button" className="secondary-btn" onClick={resetTranscript}>
                {t("app.clear")}
              </button>
              <span className="voice-transcript">{t("app.voiceHeard")}: {transcript || "..."}</span>
            </div>
          )}
        </div>
        <div className="sidebar-user">
          <p>{user.name}</p>
          <small>{user.email}</small>
          <button className="secondary-btn logout-btn" onClick={logout}>
            {t("app.logout")}
          </button>
        </div>
      </aside>
      <main className="content">
        {showSettings && (
          <section className="line-panel settings-panel">
            <h3>{t("app.openSettings")}</h3>
            <div className="settings-grid">
              <label>
                {t("app.theme")}
                <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label>
                {t("app.language")}
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                </select>
              </label>
              <label>
                {t("app.sidebarWidth")}: {sidebarWidth}px
                <input
                  type="range"
                  min="220"
                  max="420"
                  value={sidebarWidth}
                  onChange={(e) => setSidebarWidth(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="settings-grid">
              <label>
                {t("app.changePasswordCurrent")}
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              <label>
                {t("app.changePasswordNew")}
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <button type="button" className="secondary-btn" onClick={onChangePassword}>
                {t("app.changePassword")}
              </button>
            </div>
            <div className="settings-grid">
              <label>
                {t("app.deleteAccountPassword")}
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                />
              </label>
              <button type="button" className="secondary-btn" onClick={onDeleteAccount}>
                {t("app.deleteAccount")}
              </button>
            </div>
            {accountNotice && <p className="viz-helper-text">{accountNotice}</p>}
          </section>
        )}
        <header className="topbar">
          <h1>{t("app.title")}</h1>
          <p>{t("app.subtitle")}</p>
        </header>
        <Routes>
          <Route path="/" element={<Navigate to={isAuthPath ? "/auth" : "/app"} replace />} />
          <Route path="/auth" element={<Navigate to="/app" replace />} />
          <Route path="/app" element={<RunPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<RunDetailsPage />} />
          <Route path="/landing" element={<LandingPage />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
