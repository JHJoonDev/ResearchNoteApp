import { create } from 'zustand';
import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  baseURL: 'http://localhost:5000/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    const message = error.response?.data?.error || error.response?.data?.message || '서버 오류가 발생했습니다.';
    toast.error(message);
    return Promise.reject(error);
  }
);

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
