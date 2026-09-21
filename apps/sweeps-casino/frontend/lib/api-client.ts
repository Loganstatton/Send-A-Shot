import type { ApiErrorBody } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

// Access token lives in module-level memory only (never localStorage). The
// refresh token is an httpOnly cookie the backend manages; we never touch
// it directly. This module is intentionally framework-agnostic so both the
// Zustand auth store and any server-adjacent code can share it.
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

export function setAccessToken(token: string | null) {
  accessToken = token;
  tokenListeners.forEach((fn) => fn(token));
}

export function getAccessToken() {
  return accessToken;
}

export function onAccessTokenChange(fn: (token: string | null) => void) {
  tokenListeners.add(fn);
  return () => tokenListeners.delete(fn);
}

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  constructor(status: number, body: Partial<ApiErrorBody["error"]>) {
    super(body.message || "Request failed");
    this.code = body.code || "UNKNOWN_ERROR";
    this.status = status;
    this.requestId = body.requestId;
  }
}

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      setAccessToken(null);
      return null;
    }
    const json = await res.json();
    const token: string | undefined = json?.data?.accessToken;
    setAccessToken(token ?? null);
    return token ?? null;
  } catch {
    setAccessToken(null);
    return null;
  }
}

export function refreshSession(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  idempotent?: boolean;
  skipAuth?: boolean;
  skipRefreshRetry?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotent, skipAuth, skipRefreshRetry, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };

  if (!skipAuth && accessToken) {
    finalHeaders["Authorization"] = `Bearer ${accessToken}`;
  }
  if (idempotent) {
    finalHeaders["Idempotency-Key"] =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !skipAuth && !skipRefreshRetry) {
    const newToken = await refreshSession();
    if (newToken) {
      return request<T>(path, { ...options, skipRefreshRetry: true });
    }
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // no body
  }

  if (!res.ok) {
    const errBody = json?.error || { message: res.statusText, code: `HTTP_${res.status}` };
    throw new ApiError(res.status, errBody);
  }

  return (json?.data ?? json) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "DELETE" }),
};

export { API_URL };
