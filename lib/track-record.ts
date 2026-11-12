import { db } from './pg';

// A player's track record as a talent spotter: how the artists they backed
// have done ON NEXT since the moment they first backed them. Uses only the
// permanent Founding Believer record (price at backing, backer number) and
// NEXT's own current price and backer counts — it says nothing about an
// artist's real-world career, and the page labels it that way.

export type PickOutcome = { recordId: number; artistId: number; changePct: number; laterBackers: number };
export type TrackRecord = {
  picks: number;
  upCount: number;
  medianChangePct: number | null;
  laterBackers: number;
  best: { recordId: number; artistId: number; artistName: string; changePct: number } | null;
  byRecord: Record<number, PickOutcome>;
};

// Price moves smaller than this either way count as flat, not "up".
export const FLAT_BAND_PCT = 0.5;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function getTrackRecord(userId: number): Promise<TrackRecord> {
  const rows = (await db.prepare(`
    SELECT b.id AS record_id, b.artist_id, b.next_price_cents AS then_cents, b.discovery_rank,
      a.name AS artist_name, a.next_current_price_cents AS now_cents,
      (SELECT COUNT(*) FROM next_founding_believers c WHERE c.artist_id = b.artist_id) AS backers_now
    FROM next_founding_believers b
    JOIN artists a ON a.id = b.artist_id
    WHERE b.user_id = ?
  `).all(userId)) as {
    record_id: number; artist_id: number; then_cents: number; discovery_rank: number; artist_name: string; now_cents: number | null; backers_now: number;
  }[];

  const byRecord: Record<number, PickOutcome> = {};
  const changes: number[] = [];
  let upCount = 0;
  let laterBackers = 0;
  let best: TrackRecord['best'] = null;
  for (const r of rows) {
    const now = r.now_cents ?? r.then_cents;
    const changePct = r.then_cents > 0 ? Math.round(((now - r.then_cents) / r.then_cents) * 1000) / 10 : 0;
    const later = Math.max(0, r.backers_now - r.discovery_rank);
    byRecord[r.record_id] = { recordId: r.record_id, artistId: r.artist_id, changePct, laterBackers: later };
    changes.push(changePct);
    laterBackers += later;
    if (changePct > FLAT_BAND_PCT) upCount++;
    if (!best || changePct > best.changePct) best = { recordId: r.record_id, artistId: r.artist_id, artistName: r.artist_name, changePct };
  }
  const med = median(changes);
  return {
    picks: rows.length,
    upCount,
    medianChangePct: med == null ? null : Math.round(med * 10) / 10,
    laterBackers,
    best: best && best.changePct > FLAT_BAND_PCT ? best : null,
    byRecord,
  };
}
