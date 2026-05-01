import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../authStore";

function AuthPage() {
  const { t } = useTranslation();
  const { login, signup, loading, error } = useAuthStore();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (mode === "login") {
      await login({ email, password });
      return;
    }
    await signup({ name, email, password });
  };

  return (
    <div className="auth-wrap">
      <form className="panel auth-panel" onSubmit={handleSubmit}>
        <h2>{mode === "login" ? t("auth.login") : t("auth.signup")}</h2>
        {mode === "signup" && (
          <div className="field">
            <label>{t("auth.name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label>{t("auth.email")}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>{t("auth.password")}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="primary-btn" disabled={loading}>
          {loading ? t("auth.pleaseWait") : mode === "login" ? t("auth.login") : t("auth.createAccount")}
        </button>
        {error && <p className="error-text">{error}</p>}
        <button
          type="button"
          className="secondary-btn switch-btn"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? t("auth.needAccount") : t("auth.alreadyRegistered")}
        </button>
        <Link to="/" className="secondary-btn switch-btn">
          {t("app.landing")}
        </Link>
      </form>
    </div>
  );
}

export default AuthPage;
