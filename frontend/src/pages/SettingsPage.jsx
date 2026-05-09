import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiLock, FiSliders, FiTrash2 } from "react-icons/fi";
import { useAuthStore } from "../authStore";
import { useUiStore } from "../uiStore";

function SettingsPage() {
  const { t } = useTranslation();
  const { changePassword, deleteAccount } = useAuthStore();
  const { theme, setTheme, language, setLanguage } = useUiStore();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [accountNotice, setAccountNotice] = useState("");

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

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "6px 2px 10px" }}>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", padding: "16px", background: "#ffffff" }}>
        <h3 style={{ margin: "0 0 10px", display: "flex", alignItems: "center", gap: "8px", color: "#111827" }}>
          <FiSliders />
          Preferences
        </h3>
        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {t("app.theme")}
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "12px 14px", background: "#ffffff" }}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {t("app.language")}
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "12px 14px", background: "#ffffff" }}
            >
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </select>
          </label>
        </div>
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", padding: "16px", background: "#ffffff" }}>
        <h3 style={{ margin: "0 0 10px", display: "flex", alignItems: "center", gap: "8px", color: "#111827" }}>
          <FiLock />
          {t("app.changePassword")}
        </h3>
        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {t("app.changePasswordCurrent")}
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "12px 14px", background: "#ffffff" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {t("app.changePasswordNew")}
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "12px 14px", background: "#ffffff" }}
            />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              type="button"
              onClick={onChangePassword}
              style={{ width: "100%", minHeight: "44px", border: "none", borderRadius: "12px", background: "#111111", color: "#ffffff", fontWeight: 600, padding: "12px 16px" }}
            >
              {t("app.changePassword")}
            </button>
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: "14px", padding: "16px", background: "#ffffff" }}>
        <h3 style={{ margin: "0 0 10px", display: "flex", alignItems: "center", gap: "8px", color: "#111827" }}>
          <FiTrash2 />
          {t("app.deleteAccount")}
        </h3>
        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {t("app.deleteAccountPassword")}
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "12px 14px", background: "#ffffff" }}
            />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              type="button"
              onClick={onDeleteAccount}
              style={{ width: "100%", minHeight: "44px", border: "none", borderRadius: "12px", background: "#111111", color: "#ffffff", fontWeight: 600, padding: "12px 16px" }}
            >
              {t("app.deleteAccount")}
            </button>
          </div>
        </div>
      </div>

      {accountNotice && <p style={{ margin: 0, color: "#374151" }}>{accountNotice}</p>}
    </section>
  );
}

export default SettingsPage;
