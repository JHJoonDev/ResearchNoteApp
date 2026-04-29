import { create } from 'zustand';
import api from '../api/axios';

const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: !!localStorage.getItem('token'),
  token: localStorage.getItem('token') || null,
  loading: false,
  error: null,

  login: async (email, password, tenantId) => {
    set({ loading: true, error: null });
    try {
      const response = await api.post('/auth/login', { email, password, tenantId });
      if (response.data.success) {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        set({
          user: response.data.user,
          isAuthenticated: true,
          token: response.data.token,
          loading: false,
        });
        return true; 
      }
    } catch (err) {
      set({
        error: err.response?.data?.message || '로그인 중 오류가 발생했습니다.',
        loading: false,
      });
      return false;
    }
  },

  register: async (email, password, name) => {
    set({ loading: true, error: null });
    try {
      const res = await api.post('/auth/register', { email, password, name });
      set({ loading: false });
      return res.data;
    } catch (err) {
      set({ error: err.response?.data?.message || '회원가입 실패', loading: false });
      return { success: false, message: err.response?.data?.message || '회원가입 실패' };
    }
  },

  updateProfile: async (data) => {
    set({ loading: true, error: null });
    try {
      const res = await api.put('/auth/profile', data);
      if (res.data.success) {
        localStorage.setItem('user', JSON.stringify(res.data.user));
        set({ user: res.data.user, loading: false });
        return { success: true };
      }
    } catch (err) {
      set({ error: err.response?.data?.message || '프로필 업데이트 실패', loading: false });
      return { success: false, message: err.response?.data?.message || '프로필 업데이트 실패' };
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
        set({ isAuthenticated: true, token, user: JSON.parse(userStr) });
      } catch (e) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
  }
}));

export default useAuthStore;
