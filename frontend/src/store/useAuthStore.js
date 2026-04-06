import { create } from 'zustand';
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5000/api',
});

const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: !!localStorage.getItem('token'),
  token: localStorage.getItem('token') || null,
  loading: false,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const response = await api.post('/auth/login', { email, password });
      if (response.data.success) {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        set({
          user: response.data.user,
          isAuthenticated: true,
          token: response.data.token,
          loading: false,
        });
        return true; // Used for UI redirection/toast
      }
    } catch (err) {
      set({
        error: err.response?.data?.message || '로그인 중 오류가 발생했습니다.',
        loading: false,
      });
      return false;
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      // ignore
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      set({ user: null, isAuthenticated: false, token: null });
    }
  },
  
  initializeAuth: () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      try {
        set({ isAuthenticated: true, token, user: JSON.stringify(userStr) });
      } catch (e) {
        // invalid JSON
      }
    }
  }
}));

export default useAuthStore;
