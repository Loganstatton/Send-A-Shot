// One-time, idempotent backfill: NEXT Feed launched after real activity
// (candidate approvals, artist self-updates) had already happened, so
// without this the Feed reads as empty even on an app with a real history.
// This transforms EXISTING rows from before the Feed's schema existed into
// real feed_events — it invents nothing (no users, no trades, no reactions,
// no fabricated "trending" activity), and reuses the exact same
// dedupe_key scheme the live event-creating code already uses
// (approveDiscoveryCandidate, the artist-update note route), so running
// this twice — or running it after some of these events already exist
// because the live code created them first — produces zero duplicates:
// createFeedEvent's INSERT OR IGNORE already handles that.
//
// Deliberately NOT covered here: signal_*/market_momentum_* (those are a
// live read of CURRENT score/price state, not historical — the daily
// generate-signals run already covers "is anything true right now," a
// bootstrap concept doesn't apply) and founding_believer_share (never
// auto-created for existing records — a share must stay a deliberate,
// one-time user action, never something a backfill posts on someone's
// behalf).

import { breakoutScore } from './scoring';
import { createFeedEvent, db } from './db';
import { Artist } from './types';

// "Recent" — old enough that a beta launch's pre-existing history shows up,
// bounded so this never dumps months of stale approvals into a fresh Feed.
export const BOOTSTRAP_WINDOW_DAYS = 21;
export const BOOTSTRAP_CAP_PER_TYPE = 30;

export type FeedBootstrapResult = { newArtist: number; earlyDiscovery: number; artistUpdate: number };

export function bootstrapFeedFromHistory(): FeedBootstrapResult {
  const cutoff = new Date(Date.now() - BOOTSTRAP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let newArtist = 0;
  let earlyDiscovery = 0;
  let artistUpdate = 0;

  // new_artist + early_discovery: every approved candidate in the window
  // that resolved to a real, still-existing artist.
  const approvedCandidates = db
    .prepare(`
      SELECT discovery_candidates.id AS candidate_id, discovery_candidates.submitted_by_user_id, discovery_candidates.reviewed_at,
             artists.id AS artist_id
      FROM discovery_candidates
      JOIN artists ON artists.id = discovery_candidates.artist_id
      WHERE discovery_candidates.status = 'approved' AND discovery_candidates.reviewed_at >= ?
      ORDER BY discovery_candidates.reviewed_at DESC
      LIMIT ?
    `)
    .all(cutoff, BOOTSTRAP_CAP_PER_TYPE) as { candidate_id: number; submitted_by_user_id: number | null; reviewed_at: string; artist_id: number }[];

  for (const row of approvedCandidates) {
    const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(row.artist_id) as Artist | undefined;
    if (!artist) continue;

    const created = createFeedEvent({
      eventType: 'new_artist',
      artistId: artist.id,
      refType: 'discovery_candidate',
      refId: row.candidate_id,
      metadata: { genre: artist.genre, score: breakoutScore(artist) },
      dedupeKey: `new_artist:${row.candidate_id}`,
    });
    if (created) newArtist++;

    if (row.submitted_by_user_id) {
      const createdEarly = createFeedEvent({
        eventType: 'early_discovery',
        actorUserId: row.submitted_by_user_id,
        artistId: artist.id,
        refType: 'discovery_candidate',
        refId: row.candidate_id,
        metadata: { followersAtDiscovery: artist.followers_count, genre: artist.genre },
        dedupeKey: `early_discovery:${row.candidate_id}`,
      });
      if (createdEarly) earlyDiscovery++;
    }
  }

  // artist_update: real self-updates posted through the Artist Dashboard
  // note form — tagged with the exact "Artist self-update:" prefix that
  // route stamps, so this never mistakes an internal Scout contact-log
  // entry (a call note, a status change) for a public artist post.
  const selfUpdates = db
    .prepare(`
      SELECT id, artist_id FROM contact_log
      WHERE type = 'note' AND message LIKE 'Artist self-update:%' AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(cutoff, BOOTSTRAP_CAP_PER_TYPE) as { id: number; artist_id: number }[];

  for (const entry of selfUpdates) {
    const artist = db.prepare('SELECT claimed_by_user_id FROM artists WHERE id = ?').get(entry.artist_id) as { claimed_by_user_id: number | null } | undefined;
    if (!artist) continue;
    const created = createFeedEvent({
      eventType: 'artist_update',
      actorUserId: artist.claimed_by_user_id ?? undefined,
      artistId: entry.artist_id,
      refType: 'contact_log',
      refId: entry.id,
      dedupeKey: `artist_update:${entry.id}`,
    });
    if (created) artistUpdate++;
  }

  return { newArtist, earlyDiscovery, artistUpdate };
}
