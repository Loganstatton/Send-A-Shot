"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CursorPage } from "@/lib/types";

/**
 * Cursor-paginated list loader shared by every game grid / ledger / queue
 * screen — never accumulates an unbounded DOM list; "load more" appends one
 * page at a time from an explicit cursor per docs/04 cross-cutting rules.
 */
export function useCursorList<T>(fetchPage: (cursor: string | null) => Promise<CursorPage<T>>, deps: unknown[] = []) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems([]);
    setCursor(null);
    setHasMore(true);
    fetchRef
      .current(null)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setHasMore(!!page.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setHasMore(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchRef.current(cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setHasMore(!!page.nextCursor);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  return { items, loading, loadingMore, hasMore, loadMore };
}
