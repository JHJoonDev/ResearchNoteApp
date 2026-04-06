import { create } from 'zustand';
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5000/api',
});

const useAppStore = create((set) => ({
  elnData: [],
  limsData: [],
  membersData: [],
  loading: false,
  error: null,

  fetchElnData: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.get('/eln');
      set({ elnData: res.data, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  createElnNote: async (note) => {
    try {
      const res = await api.post('/eln', note);
      set((state) => ({ elnData: [res.data, ...state.elnData] }));
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
}));

export default useAppStore;
