"use client";

import { ReactNode, useEffect } from "react";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useCurrencyStore } from "@/lib/stores/currency-store";
import { ToastProvider } from "@/components/layout/Toast";

export function AppProviders({ children }: { children: ReactNode }) {
  const hydrate = useAuthStore((s) => s.hydrate);
  const hydrateCurrency = useCurrencyStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    hydrateCurrency();
  }, [hydrate, hydrateCurrency]);

  return <ToastProvider>{children}</ToastProvider>;
}
