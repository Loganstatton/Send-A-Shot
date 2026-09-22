"use client";

import { create } from "zustand";
import { api } from "@/lib/api-client";
import type { WalletBalances } from "@/lib/types";

/** "10683.08" (or a number) -> 1068308 minor units, avoiding float drift via string-based cent extraction. */
function toMinorUnits(value: string | number): number {
  return Math.round(Number(value) * 100);
}

interface WalletState {
  balances: WalletBalances | null;
  loading: boolean;
  fetchBalances: () => Promise<void>;
  applyBalanceUpdate: (currency: "GC" | "SC", balance: number) => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  balances: null,
  loading: false,
  fetchBalances: async () => {
    set({ loading: true });
    try {
      // GET /wallet returns plain decimal-dollar strings (e.g. "10683.08"),
      // not integer minor units — formatCoins() (used by every balance
      // display in the app: BalancePill, CurrencySwitcher, the wallet
      // page, ProfileMenu, WalletModal) expects minor units and divides by
      // 100, so every value is converted to minor units right here, once,
      // at the single point balances enter the store. Previously this cast
      // the raw string response straight through as if it already matched
      // WalletBalances' `number` shape, which made every balance display
      // in the app read 100x too small.
      const raw = await api.get<{ gc: { balance: string }; sc: { balance: string; eligible?: boolean; locked?: number } }>(
        "/wallet"
      );
      set({
        balances: {
          gc: { balance: toMinorUnits(raw.gc.balance) },
          sc: { balance: toMinorUnits(raw.sc.balance), eligible: raw.sc.eligible, locked: raw.sc.locked },
        },
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },
  /**
   * `balance` here is the plain decimal-dollar number every /play-style
   * response already hands callers (e.g. `Number(resp.wallet.balance)` —
   * see useOriginalGame.ts/useSlotGame.ts/useMinesRound.ts), NOT minor
   * units — converted to minor units before storing, same as
   * fetchBalances, so the store's contract is always "minor units in,
   * minor units out" regardless of which code path populated it.
   */
  applyBalanceUpdate: (currency, balance) => {
    const current = get().balances;
    if (!current) return;
    set({
      balances: {
        ...current,
        [currency === "GC" ? "gc" : "sc"]: {
          ...(currency === "GC" ? current.gc : current.sc),
          balance: Math.round(balance * 100),
        },
      },
    });
  },
}));
