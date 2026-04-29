import { create } from 'zustand';
import toast from 'react-hot-toast';
import api from '../api/axios';

const useAppStore = create((set) => ({
  elnData: [],
  elnPagination: { page: 1, totalPages: 1 },
  limsData: [],
  limsPagination: { page: 1, totalPages: 1 },
  membersData: [],
  notifications: [],
  auditLogs: [],
  dashboardStats: null,
  theme: localStorage.getItem('theme') || 'light',
  loading: false,
  settings: null,

  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },
  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', newTheme);
    return { theme: newTheme };
  }),

  fetchElnData: async (page = 1, limit = 10, search = '') => {
    set({ loading: true });
    try {
      const res = await api.get('/eln', { params: { page, limit, search } });
      if (res.data.items) {
        set({ elnData: res.data.items, elnPagination: { page: res.data.currentPage, totalPages: res.data.totalPages }, loading: false });
      } else {
        set({ elnData: res.data, loading: false }); // Fallback
      }
    } catch (err) {
      console.error(err);
      set({ loading: false });
    }
  },

  uploadFile: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      return res.data;
    } catch (err) {
      console.error(err);
      return null;
    }
  },

  createElnNote: async (note) => {
    try {
      const res = await api.post('/eln', note);
      if (res.data.id) {
        set((state) => ({ elnData: [res.data, ...state.elnData] }));
      }
      return res.data;
    } catch (err) {
      console.error(err);
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

  fetchSingleNote: async (id) => {
    try {
      const res = await api.get(`/eln/${id}`);
      return res.data;
    } catch (err) {
      console.error(err);
      return null;
    }
  },

  updateNoteApproval: async (id, approverName, action) => {
    try {
      const payload = { action };
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

  updateElnStatus: async (id, status, approverName, signature) => {
    try {
      const payload = { status, approverName, signature };
      const res = await api.put(`/eln/${id}`, payload);
      set((state) => ({
        elnData: state.elnData.map((note) => (note.id === id ? res.data : note)),
      }));
      return res.data;
    } catch (err) {
      console.error(err);
    }
  },

  addComment: async (id, text, author) => {
    try {
      const res = await api.post(`/eln/${id}/comments`, { text, author });
      return res.data;
    } catch (err) {
      console.error(err);
      return null;
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

  fetchLimsData: async (page = 1, limit = 10) => {
    set({ loading: true });
    try {
      const res = await api.get('/lims', { params: { page, limit } });
      if (res.data.items) {
        set({ limsData: res.data.items, limsPagination: { page: res.data.currentPage, totalPages: res.data.totalPages }, loading: false });
      } else {
        set({ limsData: res.data, loading: false });
      }
    } catch (err) {
      console.error(err);
      set({ loading: false });
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

  fetchDashboardStats: async (startDate, endDate) => {
    try {
      let url = '/stats';
      if (startDate && endDate) {
        url += `?startDate=${startDate}&endDate=${endDate}`;
      }
      const res = await api.get(url);
      set({ dashboardStats: res.data });
    } catch (err) {
      toast.error('통계 데이터 로드 실패');
    }
  },

  fetchNotifications: async (name, role) => {
    try {
      const res = await api.get('/notifications', { params: { name, role }, hideToast: true });
      set({ notifications: res.data });
    } catch (err) {
      console.error('Error fetching notifications', err);
    }
  },

  fetchAuditLogs: async () => {
    try {
      const res = await api.get('/audit', { params: { limit: 10 }, hideToast: true });
      set({ auditLogs: res.data.logs });
    } catch (err) {
      console.error('Error fetching audit logs', err);
    }
  },

  markNotificationAsRead: async (id) => {
    try {
      const res = await api.put(`/notifications/${id}/read`);
      set(state => ({
        notifications: state.notifications.map(n => n._id === id ? res.data : n)
      }));
    } catch (err) {
      console.error('Error marking notification as read', err);
    }
  },

  searchGlobal: async (query) => {
    try {
      const res = await api.get(`/search?q=${encodeURIComponent(query)}`);
      return res.data;
    } catch (err) {
      console.error(err);
      return { eln: [], lims: [], members: [] };
    }
  }
}));

export default useAppStore;
