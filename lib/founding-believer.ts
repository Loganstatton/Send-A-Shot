// Rarity tier for a Founding Believer record, purely a function of
// discovery_rank (how early this backer was for this specific artist) —
// no new data needed, next_founding_believers.discovery_rank already
// carries everything this needs. Shared between the live receipt page and
// the downloadable/shareable PNG (app/api/next/artists/[id]/founding-
// believer-card) so the two never drift out of sync on what counts as
// which tier.
export type FoundingBelieverTierKey = 'genesis' | 'founding' | 'early' | 'first-wave';

export type FoundingBelieverTier = {
  key: FoundingBelieverTierKey;
  label: string;
  edition: string;
};

export function getFoundingBelieverTier(discoveryRank: number): FoundingBelieverTier {
  if (discoveryRank === 1) return { key: 'genesis', label: 'Genesis Founder', edition: 'Genesis' };
  if (discoveryRank <= 10) return { key: 'founding', label: 'Founding Believer', edition: 'Founding' };
  if (discoveryRank <= 50) return { key: 'early', label: 'Early Believer', edition: 'Early Access' };
  return { key: 'first-wave', label: 'First Wave', edition: 'First Wave' };
}

// A short, card-ID-style serial — decorative (not a real unique key, two
// backers of two different artists could theoretically collide on the
// rank suffix) but reads as "this object has its own identity", which is
// the whole point. Artist initials keep it legible instead of a raw
// number soup.
export function foundingBelieverSerial(artistName: string, discoveryRank: number): string {
  const initials = artistName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase())
    .join('')
    .slice(0, 3) || 'NX';
  return `FB-${initials}-${String(discoveryRank).padStart(6, '0')}`;
}
