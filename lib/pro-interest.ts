import { db } from './pg';

// NEXT Pro is an idea being tested, not a product: there is nothing to buy
// and no payment details are ever collected. This survey asks players which
// features they'd value and what a fair monthly price would be, so the
// $7.99 idea can be checked against real answers before anything is built.
//
// Hard rule for any future Pro: it never sells virtual credits, trading
// advantages, or anything that changes standings — the game stays equal
// for free players (and paid advantages in a virtual market raise legal
// questions; see docs/LEGAL-REVIEW-PACKET.md).

export const PRO_PRICE_IDEA_CENTS = 799;

export const PRO_FEATURES = {
  analytics: 'Deeper portfolio analytics (accuracy by genre, timing, history)',
  alerts: 'Instant alerts when artists you watch move',
  verified_history: 'Longer verified growth history for artists (streams, followers)',
  leagues: 'Bigger private leagues and custom league seasons',
  early_access: 'Early look at newly added artists',
  profile: 'Profile customization and a shareable scout résumé',
  export: 'Export your picks and track record',
} as const;
export type ProFeature = keyof typeof PRO_FEATURES;

export const PRO_INTENT = {
  definitely: 'Definitely would',
  probably: 'Probably would',
  unsure: 'Not sure',
  probably_not: 'Probably not',
  definitely_not: 'Definitely not',
} as const;
export type ProIntent = keyof typeof PRO_INTENT;

const MAX_PRICE_CENTS = 100_00;

function price(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE_CENTS ? n : NaN;
}

export async function saveProInterest(userId: number, input: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const features = Array.isArray(input.features) ? [...new Set(input.features.filter((f): f is ProFeature => typeof f === 'string' && f in PRO_FEATURES))] : [];
  const top = typeof input.topFeature === 'string' && input.topFeature in PRO_FEATURES ? input.topFeature : null;
  const intent = typeof input.intent === 'string' && input.intent in PRO_INTENT ? input.intent : null;
  if (!intent) return { ok: false, error: 'Pick how likely you would be to pay $7.99/month.' };
  const prices = [price(input.tooCheap), price(input.bargain), price(input.expensive), price(input.tooExpensive)];
  if (prices.some((p) => Number.isNaN(p))) return { ok: false, error: 'Prices should be between $0 and $100.' };
  const comment = typeof input.comment === 'string' ? input.comment.trim().slice(0, 1000) || null : null;
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO pro_interest (user_id, features, top_feature, intent, too_cheap_cents, bargain_cents, expensive_cents, too_expensive_cents, comment, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET features = EXCLUDED.features, top_feature = EXCLUDED.top_feature, intent = EXCLUDED.intent,
      too_cheap_cents = EXCLUDED.too_cheap_cents, bargain_cents = EXCLUDED.bargain_cents, expensive_cents = EXCLUDED.expensive_cents,
      too_expensive_cents = EXCLUDED.too_expensive_cents, comment = EXCLUDED.comment, updated_at = EXCLUDED.updated_at`)
    .run(userId, JSON.stringify(features), top, intent, ...prices, comment, now, now);
  return { ok: true };
}

export async function getMyProInterest(userId: number) {
  const r = (await db.prepare('SELECT * FROM pro_interest WHERE user_id = ?').get(userId)) as any;
  return r ? { ...r, features: JSON.parse(r.features) as ProFeature[] } : null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export async function getProInterestSummary() {
  const rows = (await db.prepare('SELECT features, top_feature, intent, too_cheap_cents, bargain_cents, expensive_cents, too_expensive_cents, comment, updated_at FROM pro_interest ORDER BY updated_at DESC').all()) as any[];
  const featureCounts = Object.fromEntries(Object.keys(PRO_FEATURES).map((k) => [k, 0])) as Record<ProFeature, number>;
  const topCounts = { ...featureCounts };
  const intentCounts = Object.fromEntries(Object.keys(PRO_INTENT).map((k) => [k, 0])) as Record<ProIntent, number>;
  for (const r of rows) {
    for (const f of JSON.parse(r.features) as ProFeature[]) if (f in featureCounts) featureCounts[f]++;
    if (r.top_feature in topCounts) topCounts[r.top_feature as ProFeature]++;
    if (r.intent in intentCounts) intentCounts[r.intent as ProIntent]++;
  }
  const col = (k: string) => rows.map((r) => r[k]).filter((v) => v != null).map(Number);
  const wouldPay = intentCounts.definitely + intentCounts.probably;
  return {
    responses: rows.length,
    wouldPayPct: rows.length ? Math.round((wouldPay / rows.length) * 100) : null,
    featureCounts, topCounts, intentCounts,
    // Van Westendorp-style medians: the range between "bargain" and
    // "getting expensive" is roughly where people think a price is fair.
    medians: { tooCheap: median(col('too_cheap_cents')), bargain: median(col('bargain_cents')), expensive: median(col('expensive_cents')), tooExpensive: median(col('too_expensive_cents')) },
    comments: rows.filter((r) => r.comment).slice(0, 50).map((r) => ({ comment: r.comment as string, at: r.updated_at as string })),
  };
}
