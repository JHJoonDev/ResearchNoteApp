import { create } from 'zustand';
import { api, errorMessage } from '../lib/api';
let epoch = 0;
let pending = 0;
const initial = {
  elnData: [],
  elnTotal: 0,
  limsData: [],
  membersData: [],
  auditLogs: [],
  auditTotal: 0,
  auditPage: 1,
  auditLimit: 25,
  elnVersions: [],
  reagentTransactions: [],
  templates: [],
  loading: false,
  error: null,
};
const useAppStore = create((set, get) => {
  const fetchList = async (path, key) => {
    const current = epoch;
    pending += 1;
    set({ loading: true, error: null });
    try {
      const { data } = await api.get(path);
      if (current === epoch) set({ [key]: data });
      return data;
    } catch (e) {
      if (current === epoch) set({ error: errorMessage(e) });
      return null;
    } finally {
      if (current === epoch) {
        pending -= 1;
        set({ loading: pending > 0 });
      }
    }
  };
  const mutate = async (method, path, data, key, id) => {
    set({ error: null });
    const current = epoch;
    try {
      const res = await api.request({ method, url: path, data });
      if (current !== epoch) return false;
      if (key)
        set((s) => ({
          [key]:
            method === 'delete'
              ? s[key].filter((n) => n.id !== id)
              : id
                ? s[key].map((n) => (n.id === id ? res.data : n))
                : [res.data, ...s[key]],
        }));
      return res.data;
    } catch (e) {
      if (current === epoch) set({ error: errorMessage(e) });
      return false;
    }
  };
  const version = (key, id) => get()[key].find((n) => n.id === id)?.version;
  return {
    ...initial,
    clearError: () => set({ error: null }),
    fetchElnData: async () => {
      const current = epoch;
      pending += 1;
      set({ loading: true, error: null });
      try {
        const { data } = await api.get('/eln', { params: { page: 1, limit: 25 } });
        if (current === epoch) {
          set({ elnData: Array.isArray(data) ? data : data.items || [], elnTotal: Array.isArray(data) ? data.length : data.total || 0 });
        }
        return data;
      } catch (e) {
        if (current === epoch) set({ error: errorMessage(e) });
        return null;
      } finally {
        if (current === epoch) {
          pending -= 1;
          set({ loading: pending > 0 });
        }
      }
    },
    fetchLimsData: () => fetchList('/lims', 'limsData'),
    fetchMembers: () => fetchList('/members', 'membersData'),
    fetchTemplates: () => fetchList('/templates', 'templates'),
    fetchElnVersions: (id) => fetchList(`/eln/${id}/versions`, 'elnVersions'),
    fetchReagentTransactions: (id) => fetchList(`/lims/${id}/transactions`, 'reagentTransactions'),
    fetchAuditLogs: async (f = {}) => {
      const current = epoch;
      pending += 1;
      set({ loading: true, error: null });
      try {
        const { data } = await api.get(`/audit?${new URLSearchParams(f)}`);
        if (current === epoch) {
          set({
            auditLogs: Array.isArray(data) ? data : data.items || [],
            auditTotal: Array.isArray(data) ? data.length : data.total || 0,
            auditPage: Array.isArray(data) ? 1 : data.page || 1,
            auditLimit: Array.isArray(data) ? data.length || 25 : data.limit || 25,
          });
        }
        return data;
      } catch (e) {
        if (current === epoch) set({ error: errorMessage(e) });
        return null;
      } finally {
        if (current === epoch) {
          pending -= 1;
          set({ loading: pending > 0 });
        }
      }
    },
    createElnNote: (n) => mutate('post', '/eln', n, 'elnData'),
    updateElnNote: (id, n) => mutate('put', `/eln/${id}`, n, 'elnData', id),
    deleteElnNote: (id) =>
      mutate('delete', `/eln/${id}`, { version: version('elnData', id) }, 'elnData', id),
    requestElnApproval: (id) =>
      mutate(
        'post',
        `/eln/${id}/request-approval`,
        { version: version('elnData', id) },
        'elnData',
        id,
      ),
    approveElnNote: (id, comment, password) =>
      mutate(
        'post',
        `/eln/${id}/approve`,
        { comment, password, version: version('elnData', id) },
        'elnData',
        id,
      ),
    rejectElnNote: (id, comment, password) =>
      mutate(
        'post',
        `/eln/${id}/reject`,
        { comment, password, version: version('elnData', id) },
        'elnData',
        id,
      ),
    createLimsItem: (n) => mutate('post', '/lims', n, 'limsData'),
    updateLimsItem: (id, n) =>
      mutate(
        'put',
        `/lims/${id}`,
        { ...n, version: n.version ?? version('limsData', id) },
        'limsData',
        id,
      ),
    deleteLimsItem: (id) =>
      mutate('delete', `/lims/${id}`, { version: version('limsData', id) }, 'limsData', id),
    createMember: (n) => mutate('post', '/members', n, 'membersData'),
    updateMember: (id, n) => mutate('put', `/members/${id}`, n, 'membersData', id),
    deleteMember: async (id) => {
      set({ error: null });
      try {
        await api.delete(`/members/${id}`);
        const { data } = await api.get('/members');
        set({ membersData: data });
        return true;
      } catch (e) {
        set({ error: errorMessage(e) });
        return false;
      }
    },
  };
});
window.addEventListener('clear-session-data', () => {
  epoch += 1;
  pending = 0;
  useAppStore.setState(initial);
});
export default useAppStore;
