/**
 * `Promotion.rewardConfig` is generic jsonb, shaped per `type` (see
 * docs/02-database-schema.md). We support two shapes in Phase 1:
 *
 *  - flat grant:   { currency: 'GC' | 'SC', amount: '10.00' }
 *    (also used by PROMO_CODE promotions, which additionally carry a
 *    `code` field: { code: 'WELCOME10', currency: 'GC', amount: '10.00' })
 *
 *  - streak schedule (DAILY-type promotions): {
 *      schedule: [{ day: 1, gc: '100.00', sc: '0' }, ...],
 *      cooldownHours: 24,
 *    }
 *
 * New promotion types are meant to add a new shape + resolver here rather
 * than a schema migration (docs/02: "only a new reward-config schema + a
 * resolver function").
 */
import { isPositive } from '../../../libs/money/money';

export type SimpleCurrency = 'GC' | 'SC';

export interface RewardGrant {
  currency: SimpleCurrency;
  amount: string;
}

export interface ResolvedReward {
  grants: RewardGrant[];
  /** Present only when resolved from a streak schedule. */
  day?: number;
  /** Present only when resolved from a streak schedule. */
  cooldownHours?: number;
}

interface FlatRewardConfig {
  currency?: SimpleCurrency;
  amount?: string;
}

interface StreakDay {
  day: number;
  gc?: string;
  sc?: string;
}

interface StreakRewardConfig {
  schedule?: StreakDay[];
  cooldownHours?: number;
}

function isStreakConfig(config: unknown): config is StreakRewardConfig {
  return !!config && typeof config === 'object' && Array.isArray((config as StreakRewardConfig).schedule);
}

function isFlatConfig(config: unknown): config is FlatRewardConfig {
  return (
    !!config &&
    typeof config === 'object' &&
    typeof (config as FlatRewardConfig).currency === 'string' &&
    typeof (config as FlatRewardConfig).amount === 'string'
  );
}

/**
 * Resolves a `rewardConfig` JSON blob (+ optional streak `day`) into the
 * concrete currency/amount grant(s) to post via WalletService.postEntries.
 * Returns an empty `grants` array when the config doesn't resolve to
 * anything payable (e.g. a streak day past the schedule, or an amount of
 * "0.00").
 */
export function resolveReward(rewardConfig: unknown, day?: number): ResolvedReward {
  if (isStreakConfig(rewardConfig)) {
    const resolvedDay = day ?? 1;
    const entry = rewardConfig.schedule?.find((s) => s.day === resolvedDay);
    const grants: RewardGrant[] = [];
    if (entry?.gc && isPositive(entry.gc)) grants.push({ currency: 'GC', amount: entry.gc });
    if (entry?.sc && isPositive(entry.sc)) grants.push({ currency: 'SC', amount: entry.sc });
    return { grants, day: resolvedDay, cooldownHours: rewardConfig.cooldownHours ?? 24 };
  }

  if (isFlatConfig(rewardConfig) && rewardConfig.currency && rewardConfig.amount) {
    if (!isPositive(rewardConfig.amount)) return { grants: [] };
    return { grants: [{ currency: rewardConfig.currency, amount: rewardConfig.amount }] };
  }

  return { grants: [] };
}
