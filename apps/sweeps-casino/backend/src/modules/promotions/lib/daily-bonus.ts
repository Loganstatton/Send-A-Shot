/**
 * Pure streak-day computation for the Daily Bonus promotion.
 *
 * SIMPLIFICATION (documented per task spec): we do not maintain a separate
 * "streak" table. The current streak day is derived entirely from the
 * user's most recent PromotionClaim on the single seeded DAILY promotion —
 * specifically `claimedAt` and the `day` we stashed in that claim's
 * `playthroughProgress` JSON (`{ day: number }`). This keeps the streak
 * state fully reconstructible from the append-only claims/ledger history
 * (no extra mutable state to drift out of sync), at the cost of only
 * remembering one data point (the last claim) rather than the whole streak
 * history — which is all Phase 1 needs (day is capped to a 7-day cycle).
 *
 * Rules:
 *  - No prior claim                                  -> day 1
 *  - Prior claim < cooldownHours ago                  -> reject (still on cooldown)
 *  - Prior claim in [cooldownHours, 48h) ago           -> continue streak: (lastDay % 7) + 1
 *  - Prior claim >= 48h ago                            -> streak broken, resets to day 1
 */

export const STREAK_LENGTH = 7;
export const STREAK_BREAK_HOURS = 48;

export class AlreadyClaimedError extends Error {
  constructor(public readonly hoursRemaining: number) {
    super(`Daily bonus already claimed; available again in ${hoursRemaining.toFixed(1)}h.`);
    this.name = 'AlreadyClaimedError';
  }
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60);
}

/**
 * @param lastClaimedAt  `claimedAt` of the user's most recent claim on the
 *                        daily-bonus promotion, or null if they've never claimed.
 * @param lastDay         The `day` (1-7) stored on that last claim, or null.
 * @param now             Current time (injected for testability).
 * @param cooldownHours    From `rewardConfig.cooldownHours` (default 24).
 * @throws AlreadyClaimedError if still within the cooldown window.
 */
export function computeNextStreakDay(
  lastClaimedAt: Date | null,
  lastDay: number | null,
  now: Date,
  cooldownHours = 24,
): number {
  if (!lastClaimedAt) return 1;

  const hoursSince = hoursBetween(lastClaimedAt, now);

  if (hoursSince < cooldownHours) {
    throw new AlreadyClaimedError(cooldownHours - hoursSince);
  }

  if (hoursSince < STREAK_BREAK_HOURS) {
    const previousDay = lastDay ?? 0;
    return (previousDay % STREAK_LENGTH) + 1;
  }

  // 48h+ since last claim: streak broken, start over.
  return 1;
}
