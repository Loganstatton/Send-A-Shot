"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";

interface UseFetchState<T> {
  data: T | null;
  error: ApiError | Error | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * Minimal data-fetching hook for read-only GETs. Not a caching library —
 * Phase 1 doesn't need one. Fetcher must be stable (wrap with useCallback)
 * or intentionally re-created when its dependencies should refetch.
 */
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): UseFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const stableFetcher = useCallback(fetcher, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    stableFetcher()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stableFetcher, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, loading, refetch };
}
