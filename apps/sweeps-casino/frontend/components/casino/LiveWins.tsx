"use client";

// DEMO DATA ONLY — replace with a real GET /activity integration once
// there's enough real play history to feel alive (see
// apps/sweeps-casino/backend/src/modules/casino/activity/activity.controller.ts,
// which already exists and is fully built for this purpose). This
// component intentionally does NOT call that endpoint: a fresh demo
// environment has near-zero real play history, so a live feed would
// render almost empty. Nothing here is written to the backend and no
// GameRound/ledger rows are fabricated — this is purely a frontend visual.

import { useEffect, useState } from "react";
import { Trophy } from "@/components/ui/icons";
import { formatCoins, cn } from "@/lib/utils";

// Representative game names pulled from the real seeded catalog (Vaultline
// Originals + Vaultline Studios demo titles) so the feed reads as plausible
// in-app activity rather than generic placeholder copy.
const DEMO_GAMES = [
  "Plinko",
  "Mines",
  "Dice",
  "Vault Heist",
  "Golden Empire",
  "Neon Reels",
  "Blackjack Royale",
  "Crown & Anchor",
  "Lucky Sevens",
  "Diamond Cascade",
  "Midnight Roulette",
  "Fortune Wheel Live",
];

const DEMO_NAMES = ["Steven", "Maria", "Jordan", "Priya", "Coop", "Alexis", "Devon", "Nina", "Marcus", "Yuki"];

function maskName(name: string): string {
  if (name.length <= 2) return `${name[0] ?? ""}*`;
  return `${name[0]}${"*".repeat(name.length - 2)}${name[name.length - 1]}`;
}

interface WinRow {
  id: string;
  name: string;
  game: string;
  amount: number; // minor units, formatted via formatCoins()
}

function randomWin(): WinRow {
  const name = DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)];
  const game = DEMO_GAMES[Math.floor(Math.random() * DEMO_GAMES.length)];
  // A skewed range so most wins are modest with the occasional big one.
  const base = Math.random() < 0.12 ? 500_000 + Math.random() * 4_500_000 : 500 + Math.random() * 180_000;
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: maskName(name),
    game,
    amount: Math.round(base),
  };
}

const INITIAL_COUNT = 10;
const MAX_ROWS = 12;
const TICK_MS_MIN = 3000;
const TICK_MS_MAX = 5000;

export function LiveWins() {
  const [rows, setRows] = useState<WinRow[]>(() =>
    Array.from({ length: INITIAL_COUNT }, () => randomWin())
  );
  // "Prepared" tabs — Biggest Wins / Lucky Wins would filter the real
  // GET /activity?tab=big-wins / ?tab=lucky-wins endpoints once wired to
  // live data; only "Live" is fully built out visually in this pass.
  const [tab, setTab] = useState<"live" | "big" | "lucky">("live");

  useEffect(() => {
    let cancelled = false;
    function schedule() {
      const delay = TICK_MS_MIN + Math.random() * (TICK_MS_MAX - TICK_MS_MIN);
      return setTimeout(() => {
        if (cancelled) return;
        setRows((prev) => [randomWin(), ...prev].slice(0, MAX_ROWS));
        timer = schedule();
      }, delay);
    }
    let timer = schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const visibleRows = tab === "live" ? rows : [];

  return (
    <section className="mb-8 px-4 lg:px-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-accent-gc" />
          <h2 className="text-lg font-bold text-text-primary">Live Wins</h2>
        </div>
        <div className="flex gap-1 rounded-full border border-border/70 bg-surface/60 p-0.5 text-[11px] font-semibold">
          {(
            [
              ["live", "Live"],
              ["big", "Biggest"],
              ["lucky", "Lucky"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "rounded-full px-2.5 py-1 transition-colors",
                tab === key ? "bg-accent-gc/15 text-accent-gc" : "text-text-muted hover:text-text-primary"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab !== "live" ? (
        <p className="text-sm text-text-muted">
          {tab === "big" ? "Biggest wins" : "Lucky wins"} will surface here once there&apos;s enough real play
          activity — this will read from the same live feed above.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border/50 overflow-hidden rounded-xl">
          {visibleRows.map((row, i) => (
            <div
              key={row.id}
              className={cn(
                "flex items-center justify-between gap-3 px-1 py-2 text-sm",
                i === 0 && "animate-win-enter"
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="font-mono text-xs text-text-muted">{row.name}</span>
                <span className="truncate text-text-primary">{row.game}</span>
              </div>
              <span className="shrink-0 font-mono text-sm font-bold text-accent-gc">
                +{formatCoins(row.amount)} GC
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
