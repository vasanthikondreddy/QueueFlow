import axios from 'axios';

export const TOKEN_KEY = 'queueflow_token';
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const api = axios.create({ baseURL: `${API_URL}/api`, timeout: 15000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const code = err.response?.data?.error?.code;
    // Expired / invalid session -> let the AuthContext log the user out. (Wrong password is a normal form error.)
    if (err.response?.status === 401 && code !== 'INVALID_CREDENTIALS') {
      window.dispatchEvent(new CustomEvent('auth:expired', { detail: { code } }));
    }
    return Promise.reject(err);
  }
);

export const errorMessage = (err) =>
  err?.response?.data?.error?.message ||
  (err?.code === 'ERR_NETWORK' ? 'Cannot reach the server. Check your connection and try again.' : null) ||
  (err?.code === 'ECONNABORTED' ? 'The request timed out. Please try again.' : null) ||
  err?.message ||
  'Something went wrong';

export const errorCode = (err) => err?.response?.data?.error?.code;
export const unwrap = (res) => res.data.data;

export default api;
