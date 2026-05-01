import axios from 'axios';
import type { AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../utils/constants';
import { useAppStore } from '../app/store';

const instance = axios.create({
  baseURL: API_BASE_URL,
});

type RetryableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

export const extractApiErrorMessage = (error: unknown) => {
  const source = error as {
    response?: { data?: { message?: string | string[]; error?: string } };
    message?: string;
  };
  const payloadMessage = source?.response?.data?.message;
  if (Array.isArray(payloadMessage)) {
    return payloadMessage.join('; ');
  }
  return payloadMessage || source?.message || 'Request failed';
};

let refreshPromise: Promise<string | null> | null = null;

const clearAuth = () => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  useAppStore.getState().setUser(null);
};

const redirectToLogin = (reason: string) => {
  sessionStorage.setItem('authMessage', reason);
  clearAuth();
  if (window.location.pathname !== '/login') {
    window.location.replace('/login');
  }
};

const refreshAccessToken = async () => {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;
  const response = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
  const data = response.data?.data;
  if (!data?.accessToken || !data?.refreshToken) return null;
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  return data.accessToken as string;
};

instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

instance.interceptors.response.use(
  (response) => response.data?.data ?? response.data,
  async (error) => {
    const status = error?.response?.status;
    const originalRequest = error?.config as RetryableRequestConfig | undefined;
    const requestUrl = String(originalRequest?.url ?? '');
    const isAuthEndpoint = requestUrl.includes('/auth/login') || requestUrl.includes('/auth/register') || requestUrl.includes('/auth/refresh');

    if (status === 401 && originalRequest && !originalRequest._retry && !isAuthEndpoint) {
      originalRequest._retry = true;
      try {
        refreshPromise ??= refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
        const accessToken = await refreshPromise;
        if (accessToken) {
          originalRequest.headers = originalRequest.headers ?? {};
          (originalRequest.headers as any).Authorization = `Bearer ${accessToken}`;
          return instance.request(originalRequest);
        }
      } catch {
        redirectToLogin('登录状态已过期，请重新登录');
        return Promise.reject(error);
      }

      redirectToLogin('登录状态已过期，请重新登录');
    }

    error.userMessage = extractApiErrorMessage(error);
    return Promise.reject(error);
  },
);

export const http = {
  get<T>(url: string, config?: AxiosRequestConfig) {
    return instance.get<unknown, T>(url, config);
  },
  post<T>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return instance.post<unknown, T>(url, data, config);
  },
  put<T>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return instance.put<unknown, T>(url, data, config);
  },
  delete<T>(url: string, config?: AxiosRequestConfig) {
    return instance.delete<unknown, T>(url, config);
  },
};

export const unwrap = async <T>(promise: Promise<T>) => promise;
