"use client";

import { create } from "zustand";
import { api } from "@/lib/api-client";
import type { WalletBalances } from "@/lib/types";

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
      const data = await api.get<WalletBalances>("/wallet");
      set({ balances: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  applyBalanceUpdate: (currency, balance) => {
    const current = get().balances;
    if (!current) return;
    set({
      balances: {
        ...current,
        [currency === "GC" ? "gc" : "sc"]: {
          ...(currency === "GC" ? current.gc : current.sc),
          balance,
        },
      },
    });
  },
}));
