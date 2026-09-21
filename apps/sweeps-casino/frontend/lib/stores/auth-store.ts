"use client";

import { create } from "zustand";
import { api, refreshSession, setAccessToken } from "@/lib/api-client";
import type { User } from "@/lib/types";

interface AuthState {
  user: User | null;
  status: "idle" | "loading" | "authenticated" | "unauthenticated";
  hydrate: () => Promise<void>;
  setUser: (user: User | null) => void;
  refetchMe: () => Promise<void>;
  loginWithToken: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: "idle",

  hydrate: async () => {
    if (get().status === "loading") return;
    set({ status: "loading" });
    const token = await refreshSession();
    if (!token) {
      set({ status: "unauthenticated", user: null });
      return;
    }
    try {
      const me = await api.get<User>("/me");
      set({ user: me, status: "authenticated" });
    } catch {
      setAccessToken(null);
      set({ status: "unauthenticated", user: null });
    }
  },

  setUser: (user) => set({ user }),

  refetchMe: async () => {
    try {
      const me = await api.get<User>("/me");
      set({ user: me, status: "authenticated" });
    } catch {
      // leave existing state; caller can handle errors
    }
  },

  loginWithToken: async (accessToken: string) => {
    setAccessToken(accessToken);
    const me = await api.get<User>("/me");
    set({ user: me, status: "authenticated" });
  },

  logout: async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore network errors on logout
    }
    setAccessToken(null);
    set({ user: null, status: "unauthenticated" });
  },
}));
