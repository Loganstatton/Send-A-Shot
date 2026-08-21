// Scout Score: a transparent reputation number for a NEXT trader, same
// "documented, no hidden formula" spirit as lib/next-market.ts. It answers
// two different questions at once — "are your picks good" (return) and
// "do you find them early" (discovery) — because a good all-time return can
// just mean joining NEXT early and buying whatever was already popular,
// while being early is its own, separately-recognized skill.

export type ScoutStats = {
  totalReturnPct: number;
  earlyDiscoveriesCount: number; // artists backed within the first EARLY_DISCOVERY_RANK_THRESHOLD buyers
};

// "Early" means one of the first 10 people on NEXT to back that artist —
// arbitrary but simple, and stated here so it can be pointed to.
export const EARLY_DISCOVERY_RANK_THRESHOLD = 10;

const RETURN_WEIGHT = 1.5;
const RETURN_CONTRIBUTION_CAP = 40;
const EARLY_DISCOVERY_POINTS = 2;
const EARLY_DISCOVERY_BONUS_CAP = 10;

// 0-100, centered on 50 (a brand-new $10,000 account with no trades scores
// exactly 50 — neutral, not a penalty for not having played yet).
export function scoutScore(stats: ScoutStats): number {
  const returnContribution = Math.max(
    -RETURN_CONTRIBUTION_CAP,
    Math.min(RETURN_CONTRIBUTION_CAP, stats.totalReturnPct * RETURN_WEIGHT)
  );
  const earlyBonus = Math.min(EARLY_DISCOVERY_BONUS_CAP, stats.earlyDiscoveriesCount * EARLY_DISCOVERY_POINTS);
  return Math.max(0, Math.min(100, Math.round(50 + returnContribution + earlyBonus)));
}
