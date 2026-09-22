"use client";

// Small trigger that keeps Provably Fair verification out of the main
// gameplay flow (Casino Visual Redesign, Phase C — spec item 11): a
// compact "Provably Fair — verify this game" row that opens the shared
// BottomSheet containing the (restyled, functionally unchanged)
// ProvablyFairPanel.
import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ProvablyFairPanel } from "@/components/casino/originals/ProvablyFairPanel";
import { Shield, ChevronRight } from "@/components/ui/icons";
import type { SeedState } from "@/lib/types";

interface GameInfoSheetProps {
  seed: SeedState | null;
  loading: boolean;
  onRotated: (next: SeedState) => void;
}

export function GameInfoSheet({ seed, loading, onRotated }: GameInfoSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-xs text-text-muted transition-colors duration-150 hover:text-text-primary"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Shield className="h-3.5 w-3.5 text-accent-sc" />
          Provably Fair — verify this game
        </span>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Provably Fair">
        <ProvablyFairPanel seed={seed} loading={loading} onRotated={onRotated} />
      </BottomSheet>
    </>
  );
}
