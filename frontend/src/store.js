import { create } from "zustand";
import api from "./api";

export const useRunStore = create((set, get) => ({
  runs: [],
  selectedRun: null,
  loading: false,
  error: "",
  runProgress: null,

  fetchRuns: async () => {
    set({ loading: true, error: "", runProgress: null });
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

  fetchRunProgress: async (id) => {
    try {
      const { data } = await api.get(`/runs/${id}/progress`);
      set({ runProgress: data });
      return data;
    } catch (err) {
      const message = err.response?.data?.message || err.message;
      set({ error: message });
      throw err;
    }
  },

  renameRunProject: async (id, projectName) => {
    const { data } = await api.patch(`/runs/${id}`, { projectName });
    set((state) => ({
      runs: state.runs.map((run) => (String(run._id) === String(id) ? data : run)),
      selectedRun: state.selectedRun && String(state.selectedRun._id) === String(id) ? data : state.selectedRun,
    }));
    return data;
  },

  patchRun: async (id, body) => {
    const { data } = await api.patch(`/runs/${id}`, body);
    set((state) => ({
      runs: state.runs.map((run) => (String(run._id) === String(id) ? data : run)),
      selectedRun: state.selectedRun && String(state.selectedRun._id) === String(id) ? data : state.selectedRun,
    }));
    return data;
  },

  deleteRun: async (id) => {
    await api.delete(`/runs/${id}`);
    set((state) => ({
      runs: state.runs.filter((run) => String(run._id) !== String(id)),
      selectedRun: state.selectedRun && String(state.selectedRun._id) === String(id) ? null : state.selectedRun,
    }));
  },

  clearHistory: async () => {
    await api.delete("/runs");
    set({ runs: [], selectedRun: null });
  },

  executeRun: async ({ file, targetCol, projectName }) => {
    const form = new FormData();
    form.append("dataset", file);
    form.append("targetCol", targetCol);
    form.append("visualizations", "yes");
    if (projectName != null && String(projectName).trim()) {
      form.append("projectName", String(projectName).trim());
    }

    set({ loading: true, error: "" });
    try {
      const { data } = await api.post("/runs/execute", form);
      const runId = data?._id;
      if (!runId) throw new Error("Run id was not returned from backend.");

      let finalRun = data;
      for (let attempt = 0; attempt < 240; attempt += 1) {
        // Polling every 2s up to ~8 minutes.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const { data: progress } = await api.get(`/runs/${runId}/progress`);
        set({ runProgress: progress });
        if (progress.status === "completed" || progress.status === "failed") {
          const { data: refreshed } = await api.get(`/runs/${runId}`);
          finalRun = refreshed;
          break;
        }
      }
      const prev = get().runs;
      set({ loading: false, selectedRun: finalRun, runs: [finalRun, ...prev] });
      if (finalRun.status === "failed") {
        const message = finalRun.error || "Run failed";
        set({ error: message });
        throw new Error(message);
      }
      return finalRun;
    } catch (err) {
      const message = err.response?.data?.message || err.message;
      set({ loading: false, error: message });
      throw err;
    }
  },
}));
