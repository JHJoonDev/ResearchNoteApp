import { api } from './api';

let cachedUserId = '';
let cachedRequest = null;

export function loadAiStatus(userId) {
  if (cachedUserId === userId && cachedRequest) return cachedRequest;
  cachedUserId = userId;
  cachedRequest = api.get('/ai/status').then(({ data }) => ({
    enabled: data?.enabled === true,
    features: Array.isArray(data?.features) ? data.features : [],
  })).catch(() => ({ enabled: false, features: [] }));
  return cachedRequest;
}

export function resetAiStatus() {
  cachedUserId = '';
  cachedRequest = null;
}

window.addEventListener('clear-session-data', resetAiStatus);
