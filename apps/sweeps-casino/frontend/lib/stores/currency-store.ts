"use client";

import { create } from "zustand";
import type { Currency } from "@/lib/types";

const STORAGE_KEY = "vaultline.activeCurrency";

function readStoredCurrency(): Currency {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "GC" || raw === "SC") return raw;
  } catch {
    // localStorage can throw (private browsing / blocked storage) — fall back silently
  }
  return "GC";
}

function persistCurrency(value: Currency) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore — per-viewer convenience only, never load-bearing
  }
}

interface CurrencyState {
  active: Currency;
  hydrated: boolean;
  hydrate: () => void;
  setActive: (currency: Currency) => void;
}

// Active currency defaults to GC until explicitly hydrated/clicked — this is
// deliberate: the switcher must never auto-switch a user into SC play.
export const useCurrencyStore = create<CurrencyState>((set) => ({
  active: "GC",
  hydrated: false,
  hydrate: () => {
    if (typeof window === "undefined") return;
    set({ active: readStoredCurrency(), hydrated: true });
  },
  setActive: (currency) => {
    persistCurrency(currency);
    set({ active: currency });
  },
}));
