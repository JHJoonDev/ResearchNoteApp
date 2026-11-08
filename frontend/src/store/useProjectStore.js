import { create } from 'zustand';
import { api, errorMessage } from '../lib/api';
let epoch = 0;
const useProjectStore = create((set) => ({
  projects: [],
  currentProject: null,
  loading: false,
  error: null,
  fetchProjects: async () => {
    const current = epoch;
    set({ loading: true, error: null });
    try {
      const res = await api.get('/projects');
      if (current === epoch) set({ projects: res.data, loading: false });
    } catch (e) {
      if (current === epoch) set({ error: errorMessage(e), loading: false });
    }
  },
  createProject: async (data) => {
    try {
      const res = await api.post('/projects', data);
      set((s) => ({ projects: [res.data, ...s.projects] }));
      return res.data;
    } catch (e) {
      set({ error: errorMessage(e) });
      return false;
    }
  },
  setCurrentProject: (currentProject) => set({ currentProject }),
}));
window.addEventListener('clear-session-data', () => {
  epoch += 1;
  useProjectStore.setState({ projects: [], currentProject: null, error: null });
});
export default useProjectStore;
