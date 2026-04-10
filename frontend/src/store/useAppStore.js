import { create } from 'zustand';
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5000/api',
});

const useAppStore = create((set) => ({
  elnData: [],
  limsData: [],
  membersData: [],
  notifications: [],
  dashboardStats: null,
  settings: null,
  loading: false,
  error: null,
  theme: localStorage.getItem('theme') || 'light',

  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', newTheme);
    return { theme: newTheme };
  }),

  setTheme: (theme) => set(() => {
    localStorage.setItem('theme', theme);
    return { theme };
  }),

  fetchElnData: async (search = '') => {
    set({ loading: true, error: null });
    try {
      const res = await api.get('/eln', { params: { search } });
      set({ elnData: res.data, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  fetchSingleNote: async (id) => {
    set({ loading: true, error: null });
    try {
      const res = await api.get(`/eln/${id}`);
      set({ loading: false });
      return res.data;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  createElnNote: async (note) => {
    try {
      const res = await api.post('/eln', note);
      set((state) => ({ elnData: [res.data, ...state.elnData] }));
      return res.data;
    } catch (err) {
      console.error(err);
      return null;
    }
  },

  updateElnNote: async (id, updatedData) => {
    try {
      const res = await api.put(`/eln/${id}`, updatedData);
      set((state) => ({
        elnData: state.elnData.map((note) => (note.id === id ? res.data : note)),
      }));
    } catch (err) {
      console.error(err);
    }
  },

  updateElnStatus: async (id, status, approverName = null) => {
    try {
      const payload = { status };
      if (approverName) {
        payload.approverName = approverName;
      }
      const res = await api.put(`/eln/${id}`, payload);
      set((state) => ({
        elnData: state.elnData.map((note) => (note.id === id ? { ...note, status: res.data.status, approvals: res.data.approvals } : note)),
      }));
      return res.data;
    } catch (err) {
      console.error(err);
    }
  },

  deleteElnNote: async (id) => {
    try {
      await api.delete(`/eln/${id}`);
      set((state) => ({
        elnData: state.elnData.filter((note) => note.id !== id),
      }));
    } catch (err) {
      console.error(err);
    }
  },

  fetchLimsData: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.get('/lims');
      set({ limsData: res.data, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  createLimsItem: async (item) => {
    try {
      const res = await api.post('/lims', item);
      set((state) => ({ limsData: [res.data, ...state.limsData] }));
    } catch (err) {
      console.error(err);
    }
  },

  updateLimsItem: async (id, updatedData) => {
    try {
      const res = await api.put(`/lims/${id}`, updatedData);
      set((state) => ({
        limsData: state.limsData.map((item) => (item.id === id ? res.data : item)),
      }));
    } catch (err) {
      console.error(err);
    }
  },

  deleteLimsItem: async (id) => {
    try {
      await api.delete(`/lims/${id}`);
      set((state) => ({
        limsData: state.limsData.filter((item) => item.id !== id),
      }));
    } catch (err) {
      console.error(err);
    }
  },

  disposeReagent: async (id) => {
    try {
      const res = await api.put(`/lims/${id}`, { stockValue: 0, status: '만료' });
      set((state) => ({
        limsData: state.limsData.map((item) => (item.id === id ? res.data : item)),
      }));
    } catch (err) {
      console.error(err);
    }
  },

  orderReagent: async (id) => {
    try {
      const res = await api.put(`/lims/${id}`, { status: '주문 중' });
      set((state) => ({
        limsData: state.limsData.map((item) => (item.id === id ? res.data : item)),
      }));
    } catch (err) {
      console.error(err);
    }
  },

  fetchMembers: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.get('/members');
      set({ membersData: res.data, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  createMember: async (member) => {
    try {
      const res = await api.post('/members', member);
      set((state) => ({ membersData: [res.data, ...state.membersData] }));
    } catch (err) {
      console.error(err);
    }
  },

  updateMember: async (id, updatedData) => {
    try {
      const res = await api.put(`/members/${id}`, updatedData);
      set((state) => ({
        membersData: state.membersData.map((m) => (m.id === id ? res.data : m)),
      }));
    } catch (err) {
      console.error(err);
    }
  },

  deleteMember: async (id) => {
    try {
      await api.delete(`/members/${id}`);
      set((state) => ({
        membersData: state.membersData.filter((m) => m.id !== id),
      }));
    } catch (err) {
      console.error(err);
    }
  },

  fetchSettings: async () => {
    try {
      const res = await api.get('/settings');
      set({ settings: res.data });
    } catch (err) {
      console.error('Error fetching settings', err);
    }
  },

  updateSettings: async (updatedData) => {
    try {
      const res = await api.put('/settings', updatedData);
      set({ settings: res.data });
      return res.data;
    } catch (err) {
      console.error('Error updating settings', err);
    }
  },

  fetchDashboardStats: async () => {
    try {
      const res = await api.get('/stats');
      set({ dashboardStats: res.data });
    } catch (err) {
      console.error('Error fetching dashboard stats', err);
    }
  },

  fetchNotifications: async (name, role) => {
    try {
      const res = await api.get('/notifications', { params: { name, role } });
      set({ notifications: res.data });
    } catch (err) {
      console.error('Error fetching notifications', err);
    }
  },

  markNotificationAsRead: async (id) => {
    try {
      const res = await api.put(`/notifications/${id}/read`);
      set((state) => ({
        notifications: state.notifications.map((n) => (n._id === id ? res.data : n)),
      }));
    } catch (err) {
      console.error('Error marking notification as read', err);
    }
  },
}));

export default useAppStore;
