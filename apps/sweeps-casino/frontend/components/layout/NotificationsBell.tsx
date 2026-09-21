"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
import type { Notification } from "@/lib/types";
import { formatDate, cn } from "@/lib/utils";

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .get<Notification[]>("/notifications")
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  const unreadCount = items.filter((n) => !n.read).length;

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await api.post(`/notifications/${id}/read`);
    } catch {
      // best-effort
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-raised text-text-muted hover:text-text-primary"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-80 rounded-xl border border-border bg-surface shadow-xl animate-fade-in">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">Notifications</div>
          <div className="max-h-96 overflow-y-auto">
            {loading && <div className="px-4 py-6 text-center text-xs text-text-muted">Loading...</div>}
            {!loading && items.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-text-muted">You're all caught up.</div>
            )}
            {!loading &&
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={cn(
                    "block w-full border-b border-border/60 px-4 py-3 text-left last:border-b-0 hover:bg-surface-raised",
                    !n.read && "bg-accent-sc/5"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-sc" />}
                    <p className="text-sm font-medium text-text-primary">{n.title}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">{n.body}</p>
                  <p className="mt-1 text-[10px] text-text-muted/70">{formatDate(n.createdAt)}</p>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
