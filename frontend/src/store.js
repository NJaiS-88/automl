import { create } from "zustand";
import api from "./api";

export const useRunStore = create((set, get) => ({
  runs: [],
  selectedRun: null,
  loading: false,
  error: "",

  fetchRuns: async () => {
    set({ loading: true, error: "" });
    try {
      const { data } = await api.get("/runs");
      set({ runs: data, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  fetchRunById: async (id) => {
    set({ loading: true, error: "" });
    try {
      const { data } = await api.get(`/runs/${id}`);
      set({ selectedRun: data, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  executeRun: async ({ file, targetCol }) => {
    const form = new FormData();
    form.append("dataset", file);
    form.append("targetCol", targetCol);
    form.append("visualizations", "yes");

    set({ loading: true, error: "" });
    try {
      const { data } = await api.post("/runs/execute", form);
      const prev = get().runs;
      set({ loading: false, selectedRun: data, runs: [data, ...prev] });
      return data;
    } catch (err) {
      const message = err.response?.data?.message || err.message;
      set({ loading: false, error: message });
      throw err;
    }
  },
}));
