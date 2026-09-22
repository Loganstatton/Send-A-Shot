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
import { Trophy, Reels, Cards, Users } from "@/components/ui/icons";
import { OriginalArt, type OriginalSlug } from "@/components/casino/originals-art";
import { CategoryArt } from "@/components/casino/category-art";
import { formatCoins, cn } from "@/lib/utils";

type GameKind = OriginalSlug | "slots" | "table" | "live";

// Representative game names pulled from the real seeded catalog (Vaultline
// Originals + Vaultline Studios demo titles) so the feed reads as plausible
// in-app activity rather than generic placeholder copy. Each carries a
// `kind` so its row can show a real thumbnail (Originals art / category
// art) instead of a generic icon.
const DEMO_GAMES: { name: string; kind: GameKind }[] = [
  { name: "Plinko", kind: "plinko" },
  { name: "Mines", kind: "mines" },
  { name: "Dice", kind: "dice" },
  { name: "Vault Heist", kind: "slots" },
  { name: "Golden Empire", kind: "slots" },
  { name: "Neon Reels", kind: "slots" },
  { name: "Blackjack Royale", kind: "table" },
  { name: "Crown & Anchor", kind: "table" },
  { name: "Lucky Sevens", kind: "slots" },
  { name: "Diamond Cascade", kind: "slots" },
  { name: "Midnight Roulette", kind: "table" },
  { name: "Fortune Wheel Live", kind: "live" },
];

const DEMO_NAMES = ["Steven", "Maria", "Jordan", "Priya", "Coop", "Alexis", "Devon", "Nina", "Marcus", "Yuki"];

function maskName(name: string): string {
  if (name.length <= 2) return `${name[0] ?? ""}*`;
  return `${name[0]}${"*".repeat(name.length - 2)}${name[name.length - 1]}`;
}

const BIG_WIN_THRESHOLD = 500_000; // minor units (= 5,000 GC)
const LUCKY_MULTIPLIER_THRESHOLD = 15;

interface WinRow {
  id: string;
  name: string;
  game: { name: string; kind: GameKind };
  amount: number; // minor units, formatted via formatCoins()
  multiplier: number;
  big: boolean;
}

function randomWin(): WinRow {
  const name = DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)];
  const game = DEMO_GAMES[Math.floor(Math.random() * DEMO_GAMES.length)];
  const isBig = Math.random() < 0.12;
  // A skewed range so most wins are modest with the occasional big one.
  const amount = Math.round(isBig ? 500_000 + Math.random() * 4_500_000 : 500 + Math.random() * 180_000);
  const multiplier = Number((isBig ? 20 + Math.random() * 130 : 1.05 + Math.random() * 14).toFixed(2));
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: maskName(name),
    game,
    amount,
    multiplier,
    big: isBig || amount >= BIG_WIN_THRESHOLD,
  };
}

const INITIAL_COUNT = 14;
const MAX_ROWS = 24;
const VISIBLE_ROWS = 6;
const TICK_MS_MIN = 3000;
const TICK_MS_MAX = 5000;

function GameThumb({ game }: { game: { name: string; kind: GameKind } }) {
  return (
    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-white/10">
      {game.kind === "dice" || game.kind === "mines" || game.kind === "plinko" ? (
        <OriginalArt slug={game.kind} />
      ) : (
        <CategoryArt
          category={game.kind === "slots" ? "SLOTS" : game.kind === "table" ? "TABLE_GAMES" : "LIVE_CASINO"}
          seed={game.name}
        />
      )}
    </div>
  );
}

function kindIcon(kind: GameKind) {
  if (kind === "slots") return Reels;
  if (kind === "table") return Cards;
  if (kind === "live") return Users;
  return null;
}

function WinCard({ row, highlight }: { row: WinRow; highlight?: boolean }) {
  const Icon = kindIcon(row.game.kind);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors",
        row.big
          ? "border-accent-gc/40 bg-accent-gc/10 shadow-glow-gc"
          : "border-border/60 bg-surface/60"
      )}
    >
      <GameThumb game={row.game} />
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[11px] text-text-muted">
          <span className="font-mono">{row.name}</span>
          <span aria-hidden>&middot;</span>
          <span className="inline-flex items-center gap-0.5 truncate text-text-primary/80">
            {Icon && <Icon className="h-2.5 w-2.5 shrink-0" />}
            {row.game.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("font-mono text-xs font-bold", row.big ? "text-accent-gc" : "text-text-muted")}>
            {row.multiplier.toFixed(2)}x
          </span>
          <span className="font-mono text-sm font-bold text-accent-gc">+{formatCoins(row.amount)} GC</span>
        </div>
      </div>
    </div>
  );
}

export function LiveWins() {
  const [rows, setRows] = useState<WinRow[]>(() => Array.from({ length: INITIAL_COUNT }, () => randomWin()));
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

  const visibleRows = (
    tab === "big" ? rows.filter((r) => r.big) : tab === "lucky" ? rows.filter((r) => r.multiplier >= LUCKY_MULTIPLIER_THRESHOLD) : rows
  ).slice(0, VISIBLE_ROWS);

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

      {visibleRows.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing here yet — check back in a moment.</p>
      ) : (
        <div className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
          {visibleRows.map((row, i) => (
            <div key={row.id} className={cn("snap-start", i === 0 && tab === "live" && "animate-win-enter")}>
              <WinCard row={row} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
