import axios from 'axios';
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
  withCredentials: true,
});
export const errorMessage = (error) =>
  error.response?.data?.message ||
  error.response?.data?.error ||
  (error.code === 'ECONNABORTED'
    ? '응답 시간이 초과되었습니다. 다시 시도해주세요.'
    : '서버에 연결할 수 없습니다. 연결을 확인해주세요.');
api.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();
  if (!['get', 'head', 'options'].includes(method)) {
    config.headers['X-LabHub-Request'] = '1';
  }
  return config;
});
api.interceptors.response.use(
  (r) => r,
  (e) => {
    const url = e.config?.url || '';
    if (
      e.response?.status === 401 &&
      !url.includes('/auth/login') &&
      !url.includes('/auth/setup')
    )
      window.dispatchEvent(new Event('session-expired'));
    return Promise.reject(e);
  },
);
export function downloadBlob(data, name, type = 'application/json') {
  const url = URL.createObjectURL(
    data instanceof Blob ? data : new Blob([JSON.stringify(data, null, 2)], { type }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
