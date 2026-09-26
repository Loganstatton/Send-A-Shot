"use client";

import { useEffect, useState } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api-client";
import type { ActivityItem, CursorPage } from "@/lib/types";
import { formatCoins, formatDate, maskDisplayName, cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";

const TABS = [
  { key: "all", label: "All Plays" },
  { key: "big-wins", label: "Big Wins" },
  { key: "lucky-wins", label: "Lucky Wins" },
  { key: "mine", label: "My Plays" },
];

const POLL_MS = 8000;

export function ActivityPanel({
  collapsed,
  onToggle,
  standalone,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** Render as a normal-flow, always-visible block instead of the sticky
   * desktop-only (`xl:`) right-hand rail — used when this panel is the
   * main content of its own page (see app/(main)/social/live-activity)
   * rather than layout.tsx's persistent sidebar-adjacent rail. */
  standalone?: boolean;
}) {
  const [tab, setTab] = useState("all");
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [anonymize, setAnonymize] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval>;

    async function load() {
      try {
        const res = await api.get<CursorPage<ActivityItem>>(`/activity?tab=${tab}`);
        if (!cancelled) setItems(res.items);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    load();
    timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tab]);

  if (collapsed && !standalone) {
    return (
      <button
        onClick={onToggle}
        aria-label="Expand activity panel"
        className="sticky top-16 hidden h-[calc(100vh-64px)] w-8 shrink-0 items-center justify-center border-l border-border bg-surface/40 text-text-muted hover:text-text-primary xl:flex"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    );
  }

  return (
    <aside
      className={cn(
        "flex-col border-border bg-surface/40",
        standalone
          ? "flex w-full rounded-xl bg-surface-raised/40"
          : "sticky top-16 hidden h-[calc(100vh-64px)] w-72 shrink-0 border-l xl:flex"
      )}
    >
      {!standalone && (
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Community</span>
          <button onClick={onToggle} aria-label="Collapse activity panel" className="rounded p-1 text-text-muted hover:text-text-primary">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
      <Tabs
        tabs={TABS}
        active={tab}
        onChange={setTab}
        className="border-b-0 px-2 pt-1 text-xs [&_button]:px-2.5 [&_button]:py-2"
      />
      <label className="flex items-center gap-2 border-b border-border px-4 py-2 text-[11px] text-text-muted">
        <input type="checkbox" checked={anonymize} onChange={(e) => setAnonymize(e.target.checked)} />
        Anonymize player names
      </label>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading &&
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="mb-2 h-12 w-full rounded-lg" />)}

        {!loading && items.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-text-muted">No activity yet — be the first to play.</p>
        )}

        {!loading &&
          items.map((item) => (
            <div key={item.id} className="mb-1.5 flex items-center justify-between rounded-lg px-2 py-2 hover:bg-surface-raised">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-text-primary">
                  {anonymize ? maskDisplayName(item.displayName) : item.displayName}
                </p>
                <p className="truncate text-[11px] text-text-muted">{item.gameName}</p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    "font-mono text-xs font-bold",
                    item.currency === "GC" ? "text-accent-gc" : "text-accent-sc"
                  )}
                >
                  +{formatCoins(item.amount)}
                </p>
                <p className="text-[10px] text-text-muted">{item.multiplier.toFixed(2)}x</p>
              </div>
            </div>
          ))}
      </div>
    </aside>
  );
}
