import axios from "axios";

export const API_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("token");
      if (!location.pathname.startsWith("/login")) {
        location.replace("/login");
      }
    }
    return Promise.reject(err);
  },
);
