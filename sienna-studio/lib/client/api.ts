'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: 'no-store',
  });
  if (res.status === 401 && typeof window !== 'undefined' && !url.startsWith('/api/auth')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.details);
  return data as T;
}

export async function uploadImage(file: File, purpose: 'ref' | 'up', label?: string) {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', purpose);
  if (label) form.append('label', label);
  return api<import('../types').StoredImage>('/api/uploads', { method: 'POST', body: form });
}

/** Tiny SWR-style hook: fetch on mount, expose data/error/reload/setData. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const urlRef = useRef(url);
  urlRef.current = url;

  const reload = useCallback(async () => {
    if (!urlRef.current) return;
    setLoading(true);
    try {
      const d = await api<T>(urlRef.current);
      setData(d);
      setError(null);
      return d;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (url) reload();
  }, [url, reload]);

  return { data, error, loading, reload, setData };
}

export const fileUrl = (file: string) => `/api/files/${file}`;
