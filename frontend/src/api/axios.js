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
    // 백그라운드 폴링 등에서 토스트 알림을 생략하고 싶을 경우
    if (error.config && error.config.hideToast) {
      return Promise.reject(error);
    }

    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      return Promise.reject(error);
    }
    
    const message = error.response?.data?.error || error.response?.data?.message || '서버 오류가 발생했습니다.';
    
    // 중복 토스트 방지 (같은 메시지가 이미 떠있는지 확인 가능하지만, 여기서는 기본적으로 띄웁니다)
    toast.error(message, { id: 'server_error' }); // id를 지정하여 연속된 동일 에러 메시지 도배 방지
    
    return Promise.reject(error);
  }
);

export default api;
