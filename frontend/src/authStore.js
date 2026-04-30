import { create } from "zustand";
import api from "./api";

const storedUser = localStorage.getItem("user");

export const useAuthStore = create((set) => ({
  user: storedUser ? JSON.parse(storedUser) : null,
  loading: false,
  error: "",

  signup: async ({ name, email, password }) => {
    set({ loading: true, error: "" });
    try {
      const { data } = await api.post("/auth/signup", { name, email, password });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      set({ user: data.user, loading: false });
    } catch (err) {
      set({ loading: false, error: err.response?.data?.message || err.message });
      throw err;
    }
  },

  login: async ({ email, password }) => {
    set({ loading: true, error: "" });
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      set({ user: data.user, loading: false });
    } catch (err) {
      set({ loading: false, error: err.response?.data?.message || err.message });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    set({ user: null });
  },
}));
