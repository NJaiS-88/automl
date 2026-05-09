import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const DialogContext = createContext(null);

function DialogBackdrop({ children, onRequestClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onRequestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRequestClose]);

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onRequestClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        boxSizing: "border-box",
        background: "rgba(17, 24, 39, 0.45)",
        backdropFilter: "blur(2px)",
      }}
    >
      {children}
    </div>
  );
}

function DialogPanel({
  title,
  message,
  variant,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  noticeFallback,
}) {
  const btnPrimary = {
    border: "none",
    borderRadius: "12px",
    padding: "10px 18px",
    minHeight: "44px",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.96rem",
  };

  const isConfirm = variant === "confirm";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="frontend-dialog-title"
      aria-describedby="frontend-dialog-desc"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        width: "min(420px, 100%)",
        maxHeight: "min(72vh, 520px)",
        overflow: "auto",
        borderRadius: "14px",
        border: "1px solid #e5e7eb",
        background: "#ffffff",
        boxShadow: "0 22px 50px rgba(0, 0, 0, 0.18)",
        boxSizing: "border-box",
        padding: "22px 20px 18px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      {title?.trim() ? (
        <h2 id="frontend-dialog-title" style={{ margin: 0, color: "#111827", fontSize: "1.12rem", fontWeight: 700 }}>
          {title.trim()}
        </h2>
      ) : (
        <h2
          id="frontend-dialog-title"
          style={{
            position: "absolute",
            width: "1px",
            height: "1px",
            padding: 0,
            margin: "-1px",
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {noticeFallback}
        </h2>
      )}
      <p id="frontend-dialog-desc" style={{ margin: 0, color: "#4b5563", fontSize: "0.98rem", lineHeight: 1.52, whiteSpace: "pre-wrap" }}>
        {message}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "flex-end", marginTop: "4px" }}>
        {isConfirm ? (
          <button
            type="button"
            onClick={onCancel}
            style={{
              ...btnPrimary,
              background: "#ffffff",
              color: "#111827",
              border: "1px solid #d1d5db",
            }}
          >
            {cancelText}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onConfirm}
          style={{
            ...btnPrimary,
            background: "#111111",
            color: "#ffffff",
          }}
        >
          {confirmText}
        </button>
      </div>
    </div>
  );
}

/** @typedef {{ type:'alert'; message:string; title?: string; resolve:()=>void }} AlertState */
/** @typedef {{ type:'confirm'; message:string; title?: string; confirmText:string; cancelText:string; resolve:(v:boolean)=>void }} ConfirmState */

export function FrontendDialogsProvider({ children }) {
  /** @type {[AlertState | ConfirmState | null, function]} */
  const [dialog, setDialog] = useState(null);

  const close = useCallback(() => setDialog(null), []);

  const alert = useCallback(
    /** @returns {Promise<void>} */
    (message, options = {}) =>
      new Promise((resolve) => {
        const title = options.title ?? "";
        const confirmText = options.confirmText;
        setDialog({
          type: "alert",
          message: String(message || ""),
          title,
          resolve: () => resolve(),
          confirmText,
        });
      }),
    []
  );

  const confirm = useCallback(
    /** @returns {Promise<boolean>} */
    (options) =>
      new Promise((resolve) => {
        setDialog({
          type: "confirm",
          title: options?.title ?? "",
          message: String(options?.message || ""),
          confirmText: options?.confirmText ?? "OK",
          cancelText: options?.cancelText ?? "Cancel",
          resolve,
        });
      }),
    []
  );

  const value = useMemo(() => ({ alert, confirm, close }), [alert, confirm, close]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog ? <ActiveDialog dialog={dialog} onDismiss={close} /> : null}
    </DialogContext.Provider>
  );
}

function ActiveDialog({ dialog, onDismiss }) {
  const { t } = useTranslation();
  const defaultOk = t("dialogs.ok");
  const noticeFallback = t("dialogs.notice");

  if (dialog.type === "alert") {
    const title = dialog.title || "";
    const confirmText = dialog.confirmText ?? defaultOk;
    return (
      <DialogBackdrop onRequestClose={() => { dialog.resolve(); onDismiss(); }}>
        <DialogPanel
          variant="alert"
          title={title}
          noticeFallback={noticeFallback}
          message={dialog.message}
          confirmText={confirmText}
          onConfirm={() => { dialog.resolve(); onDismiss(); }}
          onCancel={() => {}}
        />
      </DialogBackdrop>
    );
  }

  return (
    <DialogBackdrop onRequestClose={() => { dialog.resolve(false); onDismiss(); }}>
      <DialogPanel
        variant="confirm"
        title={dialog.title || ""}
        noticeFallback={noticeFallback}
        message={dialog.message}
        confirmText={dialog.confirmText}
        cancelText={dialog.cancelText}
        onConfirm={() => { dialog.resolve(true); onDismiss(); }}
        onCancel={() => { dialog.resolve(false); onDismiss(); }}
      />
    </DialogBackdrop>
  );
}

export function useFrontendDialogs() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useFrontendDialogs must be used within FrontendDialogsProvider");
  return ctx;
}
