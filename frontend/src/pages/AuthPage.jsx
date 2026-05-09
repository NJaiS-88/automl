import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../authStore";
import patternImage from "../assets/pattern.png";

function AuthPage() {
  const { t } = useTranslation();
  const { login, signup, loading, error } = useAuthStore();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const isLoginMode = mode === "login";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (mode === "login") {
      await login({ email, password });
      return;
    }
    await signup({ name, email, password });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? "12px" : "24px",
        overflow: "hidden",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        backgroundImage: `url(${patternImage})`,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
      }}
    >
      <style>
        {`
          @keyframes auth-spinner {
            to {
              transform: rotate(360deg);
            }
          }
        `}
      </style>
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: isMobile ? "100%" : "420px",
          background: "#ffffff",
          borderRadius: "18px",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.15)",
          padding: isMobile ? "22px 16px" : "30px 24px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <h2 style={{ margin: 0, textAlign: "center", fontSize: isMobile ? "1.45rem" : "1.7rem", color: "#111827" }}>
          {isLoginMode ? t("auth.login") : t("auth.signup")}
        </h2>
        {!isLoginMode && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ color: "#374151", fontWeight: 500 }}>{t("auth.name")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{
                border: "1px solid #d1d5db",
                borderRadius: "12px",
                padding: "12px 14px",
                outline: "none",
              }}
            />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ color: "#374151", fontWeight: 500 }}>{t("auth.email")}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              border: "1px solid #d1d5db",
              borderRadius: "12px",
              padding: "12px 14px",
              outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ color: "#374151", fontWeight: 500 }}>{t("auth.password")}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              border: "1px solid #d1d5db",
              borderRadius: "12px",
              padding: "12px 14px",
              outline: "none",
            }}
          />
        </div>
        <button
          disabled={loading}
          style={{
            border: "none",
            borderRadius: "12px",
            padding: "12px 14px",
            fontWeight: 600,
            color: "#ffffff",
            background: loading ? "#1e3a8a" : "#2563eb",
            cursor: loading ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            transition: "background-color 150ms ease",
          }}
        >
          {loading && (
            <span
              aria-hidden="true"
              style={{
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                border: "2px solid rgba(255, 255, 255, 0.45)",
                borderTopColor: "#ffffff",
                animation: "auth-spinner 0.8s linear infinite",
              }}
            />
          )}
          {loading ? t("auth.pleaseWait") : isLoginMode ? t("auth.login") : t("auth.createAccount")}
        </button>
        {error && <p style={{ margin: 0, color: "#b91c1c", fontSize: "0.92rem" }}>{error}</p>}
        <button
          type="button"
          style={{
            border: "1px solid #cbd5e1",
            borderRadius: "12px",
            padding: "12px 14px",
            background: "#ffffff",
            color: "#1e3a8a",
            fontWeight: 600,
            cursor: "pointer",
          }}
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {isLoginMode ? t("auth.needAccount") : t("auth.alreadyRegistered")}
        </button>
      </form>
    </div>
  );
}

export default AuthPage;
