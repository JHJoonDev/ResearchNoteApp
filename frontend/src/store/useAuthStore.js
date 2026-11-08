import { create } from 'zustand';
import { api, errorMessage } from '../lib/api';
let epoch = 0;
const clear = () => {
  epoch += 1;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.dispatchEvent(new Event('clear-session-data'));
};
const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  initializing: true,
  loading: false,
  error: null,
  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      if (data.mfaRequired) {
        set({ loading: false });
        return { mfaRequired: true, mfaToken: data.mfaToken };
      }
      const { data: session } = await api.get('/auth/me');
      set({ user: session.user, isAuthenticated: true, loading: false, initializing: false });
      return { authenticated: true };
    } catch (e) {
      set({ error: errorMessage(e), loading: false });
      return null;
    }
  },
  completeMfaLogin: async (mfaToken, code) => {
    set({ loading: true, error: null });
    try {
      await api.post('/auth/login/mfa', { mfaToken, code });
      const { data } = await api.get('/auth/me');
      set({ user: data.user, isAuthenticated: true, loading: false, initializing: false });
      return true;
    } catch (e) {
      set({ error: errorMessage(e), loading: false });
      return false;
    }
  },
  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* Clear the local session even when offline. */
    } finally {
      clear();
      set({ user: null, isAuthenticated: false });
    }
  },
  initializeAuth: async () => {
    const current = epoch;
    set({ initializing: true, error: null });
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    try {
      const { data } = await api.get('/auth/me');
      if (current === epoch) set({ user: data.user, isAuthenticated: true, initializing: false });
    } catch (e) {
      if (current === epoch) {
        const unauthenticated = e.response?.status === 401;
        set({
          user: null,
          isAuthenticated: false,
          initializing: false,
          error: unauthenticated ? null : errorMessage(e),
        });
      }
    }
  },
}));
window.addEventListener('session-expired', () => {
  clear();
  useAuthStore.setState({ user: null, isAuthenticated: false, initializing: false });
});
export default useAuthStore;
