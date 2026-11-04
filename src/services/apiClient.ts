/**
 * Centralized API Client for Al-Mizan ERP
 * Handles Bearer token injection, unified error responses, and 401 session expiration.
 */

export interface ApiError extends Error {
  status?: number;
  data?: any;
}

function getAuthToken(): string | null {
  return localStorage.getItem('almizan_token');
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // If there is a body and it is not FormData/URLSearchParams, set JSON header
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const url = endpoint.startsWith('http') || endpoint.startsWith('/api')
    ? endpoint
    : `/api${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  let res: Response;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (err: any) {
    const networkErr: ApiError = new Error('تعذر الاتصال بالخادم. يرجى التحقق من اتصال الشبكة.');
    networkErr.data = err;
    throw networkErr;
  }

  // Handle 401 Unauthorized
  if (res.status === 401) {
    localStorage.removeItem('almizan_token');
    window.dispatchEvent(new CustomEvent('almizan:unauthorized', { detail: { endpoint } }));
    const err: ApiError = new Error('انتهت صلاحية جلسة العمل أو يجب تسجيل الدخول.');
    err.status = 401;
    throw err;
  }

  let data: any = null;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const errorMsg = data?.error || data?.message || `خطأ في الخادم (رمز الحالة: ${res.status})`;
    const err: ApiError = new Error(errorMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data as T;
}

export const apiClient = {
  get: <T = any>(endpoint: string, options?: RequestInit) =>
    apiRequest<T>(endpoint, { method: 'GET', ...options }),

  post: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiRequest<T>(endpoint, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options
    }),

  put: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiRequest<T>(endpoint, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options
    }),

  del: <T = any>(endpoint: string, options?: RequestInit) =>
    apiRequest<T>(endpoint, { method: 'DELETE', ...options }),

  delete: <T = any>(endpoint: string, options?: RequestInit) =>
    apiRequest<T>(endpoint, { method: 'DELETE', ...options })
};
