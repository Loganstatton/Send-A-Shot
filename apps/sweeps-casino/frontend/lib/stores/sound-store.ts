"use client";

// Shared sound-preference store — no existing pattern for this in the
// codebase (checked: no other component reads/writes a sound-related
// localStorage key), so this establishes one, generic enough for any
// game to reuse (Vault Breaker is the first consumer). Persists a master
// on/off + volume to localStorage; browsers with storage disabled/blocked
// (private windows, etc.) just fall back to the in-memory default each
// load rather than throwing.
import { create } from "zustand";

const STORAGE_KEY = "vaultline:sound-prefs:v1";

interface SoundPrefs {
  enabled: boolean;
  volume: number; // 0..1
}

function readPrefs(): SoundPrefs {
  if (typeof window === "undefined") return { enabled: true, volume: 0.55 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: true, volume: 0.55 };
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      volume: typeof parsed.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : 0.55,
    };
  } catch {
    return { enabled: true, volume: 0.55 };
  }
}

function writePrefs(prefs: SoundPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore — private window / storage blocked
  }
}

interface SoundState extends SoundPrefs {
  setEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
  toggle: () => void;
}

export const useSoundStore = create<SoundState>((set, get) => ({
  ...readPrefs(),
  setEnabled: (enabled) => {
    set({ enabled });
    writePrefs({ enabled, volume: get().volume });
  },
  setVolume: (volume) => {
    const clamped = Math.min(1, Math.max(0, volume));
    set({ volume: clamped });
    writePrefs({ enabled: get().enabled, volume: clamped });
  },
  toggle: () => {
    const next = !get().enabled;
    set({ enabled: next });
    writePrefs({ enabled: next, volume: get().volume });
  },
}));
