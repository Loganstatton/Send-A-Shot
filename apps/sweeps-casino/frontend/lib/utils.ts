export function cn(...classes: Array<string | boolean | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** Amounts arrive from the backend as integer minor units (fixed-point, no floats — see docs/01 §libs/money). */
export function formatCoins(minorUnits: number): string {
  const value = minorUnits / 100;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatCurrencyLabel(currency: "GC" | "SC"): string {
  return currency === "GC" ? "Gold Coins" : "Sweeps Coins";
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function maskDisplayName(name: string): string {
  if (name.length <= 2) return name[0] + "*";
  return name.slice(0, 2) + "*".repeat(Math.max(3, name.length - 2));
}
