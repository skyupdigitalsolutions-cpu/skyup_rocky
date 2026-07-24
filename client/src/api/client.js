import axios from 'axios';

// Uses same-origin /api in dev (Vite proxy) or an absolute base in production.
const baseURL = (import.meta.env.VITE_API_BASE || '') + '/api';

export const api = axios.create({ baseURL, withCredentials: true });

// Bearer fallback for environments where third-party cookies are blocked.
const TOKEN_KEY = 'rocky_token';
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
api.interceptors.request.use((config) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

export function apiError(err) {
  return err?.response?.data?.error || err?.message || 'Something went wrong';
}