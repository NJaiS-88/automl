import { create } from "zustand";

const THEME_KEY = "ui_theme";
const SIDEBAR_WIDTH_KEY = "ui_sidebar_width";
const LANGUAGE_KEY = "ui_language";

const storedTheme = localStorage.getItem(THEME_KEY) || "light";
const storedSidebarWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY) || 280);
const storedLanguage = localStorage.getItem(LANGUAGE_KEY) || "en";

export const useUiStore = create((set, get) => ({
  theme: storedTheme === "dark" ? "dark" : "light",
  sidebarWidth: Number.isFinite(storedSidebarWidth)
    ? Math.min(420, Math.max(220, storedSidebarWidth))
    : 280,
  language: storedLanguage === "hi" ? "hi" : "en",

  setTheme: (theme) => {
    const next = theme === "dark" ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next);
    set({ theme: next });
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    set({ theme: next });
  },
  setSidebarWidth: (width) => {
    const next = Math.min(420, Math.max(220, Number(width) || 280));
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    set({ sidebarWidth: next });
  },
  setLanguage: (language) => {
    const next = language === "hi" ? "hi" : "en";
    localStorage.setItem(LANGUAGE_KEY, next);
    set({ language: next });
  },
}));
