// Persistence for one in-flight "logical spin attempt" — the idempotency-key
// lifecycle useSlotGame.ts's spin() drives. This is a same-device,
// same-session reconciliation mechanism (sessionStorage), not cross-device
// sync: its only job is to survive a reload or the tab being backgrounded
// while a spin is unresolved, so the SAME Idempotency-Key can be reused
// instead of the player silently losing track of a wager that may already
// have settled server-side (or spinning again on top of it).
export interface PendingSpinAttempt {
  idempotencyKey: string;
  betAmount: number;
  currency: "GC" | "SC";
  createdAt: number;
}

function storageKey(slug: string): string {
  return `vault-breaker:pending-spin:${slug}`;
}

export function readPendingSpin(slug: string): PendingSpinAttempt | null {
  try {
    const raw = sessionStorage.getItem(storageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.idempotencyKey !== "string" ||
      typeof parsed.betAmount !== "number" ||
      (parsed.currency !== "GC" && parsed.currency !== "SC")
    ) {
      return null;
    }
    return parsed as PendingSpinAttempt;
  } catch {
    // Private-mode / blocked storage — no cross-reload recovery possible,
    // but the caller's in-memory in-flight guard still blocks a double-tap
    // within this same page load.
    return null;
  }
}

export function writePendingSpin(slug: string, attempt: PendingSpinAttempt): void {
  try {
    sessionStorage.setItem(storageKey(slug), JSON.stringify(attempt));
  } catch {
    // See readPendingSpin — degrade silently, never throw out of spin().
  }
}

export function clearPendingSpin(slug: string): void {
  try {
    sessionStorage.removeItem(storageKey(slug));
  } catch {
    // ignore
  }
}
