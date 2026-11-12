import { db } from './pg';
import { addLogEntry, getArtist, updateArtist } from './db';

// Requests about an artist's profile (migration 008). Two audiences:
//  - the verified artist (claimed_by_user_id) can ask for a correction, a
//    review of their rating, or to be removed from NEXT entirely;
//  - anyone signed in can report impersonation, dispute a claim, or flag a
//    factual correction.
// Staff review every request in /artist-requests. Nothing changes on the
// profile until a person resolves it — except that resolving an opt-out
// removes the artist from NEXT, which is what it asks for.
//
// A rating review is a request for a Scout to look again, never a way to
// buy or negotiate a higher Score; the resolution note says what happened.

export const REQUEST_KINDS = ['correction', 'rating_review', 'opt_out', 'impersonation', 'claim_dispute'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const OWNER_KINDS: RequestKind[] = ['correction', 'rating_review', 'opt_out'];
export const PUBLIC_KINDS: RequestKind[] = ['correction', 'impersonation', 'claim_dispute'];

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  correction: 'Correct information',
  rating_review: 'Review my rating',
  opt_out: 'Remove me from NEXT',
  impersonation: 'Impersonation',
  claim_dispute: 'Wrong person claimed this profile',
};

export const REQUEST_MESSAGE_MIN = 10;
export const REQUEST_MESSAGE_MAX = 1000;
export const REQUESTS_PER_DAY = 5;

export type ArtistRequest = {
  id: number; artist_id: number; user_id: number | null; kind: RequestKind; message: string; from_owner: boolean;
  status: 'open' | 'resolved' | 'rejected'; created_at: string; resolved_at: string | null; resolution_note: string | null;
};

type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: 400 | 403 | 404 | 409 | 429; error: string };

const toRequest = (r: any): ArtistRequest => ({ ...r, from_owner: r.from_owner === 1 });

export async function createArtistRequest(input: { artistId: number; userId: number; kind: unknown; message: unknown }): Promise<Result<{ request: ArtistRequest }>> {
  const artist = await getArtist(input.artistId);
  if (!artist) return { ok: false, status: 404, error: 'Artist not found.' };
  const isOwner = artist.claimed_by_user_id === input.userId;
  const kind = input.kind as RequestKind;
  if (!REQUEST_KINDS.includes(kind)) return { ok: false, status: 400, error: 'Choose what this is about.' };
  if (!isOwner && !PUBLIC_KINDS.includes(kind)) return { ok: false, status: 403, error: 'Only the verified artist can ask for that.' };
  if (isOwner && !OWNER_KINDS.includes(kind)) return { ok: false, status: 400, error: "That isn't available for your own profile." };
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length < REQUEST_MESSAGE_MIN) return { ok: false, status: 400, error: `Tell us a bit more (at least ${REQUEST_MESSAGE_MIN} characters).` };

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const recent = (await db.prepare('SELECT COUNT(*) AS c FROM artist_requests WHERE user_id = ? AND created_at >= ?').get(input.userId, since)) as { c: number };
  if (recent.c >= REQUESTS_PER_DAY) return { ok: false, status: 429, error: `You can send ${REQUESTS_PER_DAY} reports a day — try again tomorrow.` };
  const open = await db.prepare("SELECT id FROM artist_requests WHERE artist_id = ? AND user_id = ? AND kind = ? AND status = 'open'").get(input.artistId, input.userId, kind);
  if (open) return { ok: false, status: 409, error: "You already have an open request like this — we'll get to it." };

  const info = await db.prepare(
    'INSERT INTO artist_requests (artist_id, user_id, kind, message, from_owner, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(input.artistId, input.userId, kind, message.slice(0, REQUEST_MESSAGE_MAX), isOwner ? 1 : 0, 'open', new Date().toISOString());
  const request = toRequest(await db.prepare('SELECT * FROM artist_requests WHERE id = ?').get(info.lastInsertRowid));
  return { ok: true, request };
}

export async function getRequestsForArtist(artistId: number): Promise<ArtistRequest[]> {
  return ((await db.prepare('SELECT * FROM artist_requests WHERE artist_id = ? ORDER BY created_at DESC, id DESC').all(artistId)) as any[]).map(toRequest);
}

export async function getOwnerRequests(artistId: number, ownerId: number): Promise<ArtistRequest[]> {
  return ((await db.prepare('SELECT * FROM artist_requests WHERE artist_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC').all(artistId, ownerId)) as any[]).map(toRequest);
}

export type QueueEntry = ArtistRequest & { artist_name: string; reporter_name: string | null; reporter_email: string | null };

export async function getRequestQueue(status: 'open' | 'closed' = 'open'): Promise<QueueEntry[]> {
  return ((await db.prepare(`
    SELECT r.*, a.name AS artist_name, u.name AS reporter_name, u.email AS reporter_email
    FROM artist_requests r
    JOIN artists a ON a.id = r.artist_id
    LEFT JOIN users u ON u.id = r.user_id
    WHERE ${status === 'open' ? "r.status = 'open'" : "r.status <> 'open'"}
    ORDER BY ${status === 'open' ? 'r.created_at ASC' : 'r.resolved_at DESC'}, r.id ASC
    LIMIT 200
  `).all()) as any[]).map(toRequest) as QueueEntry[];
}

export async function getOpenRequestCount(): Promise<number> {
  return ((await db.prepare("SELECT COUNT(*) AS c FROM artist_requests WHERE status = 'open'").get()) as { c: number }).c;
}

// Staff decision. A resolved opt-out removes the artist from NEXT (stage
// 'passed' — no new backing; existing holders can still sell) and logs it.
export async function resolveArtistRequest(
  id: number, decision: unknown, note: unknown, actor: { id: number; name: string },
): Promise<Result> {
  if (decision !== 'resolved' && decision !== 'rejected') return { ok: false, status: 400, error: 'Choose resolve or reject.' };
  const resolution = typeof note === 'string' ? note.trim().slice(0, 1000) : '';
  if (!resolution) return { ok: false, status: 400, error: 'Add a short note on what was done — the requester sees it.' };
  const req = (await db.prepare('SELECT * FROM artist_requests WHERE id = ?').get(id)) as any;
  if (!req) return { ok: false, status: 404, error: 'Request not found.' };
  if (req.status !== 'open') return { ok: false, status: 409, error: 'Already handled.' };
  await db.prepare('UPDATE artist_requests SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ? WHERE id = ?')
    .run(decision, new Date().toISOString(), actor.id, resolution, id);
  if (decision === 'resolved' && req.kind === 'opt_out') {
    await updateArtist(req.artist_id, { stage: 'passed' } as any, actor);
    await addLogEntry(req.artist_id, { type: 'note', message: `Removed from NEXT at the artist's request: ${resolution}` }, actor);
  } else {
    await addLogEntry(req.artist_id, { type: 'note', message: `${REQUEST_KIND_LABELS[req.kind as RequestKind]} request ${decision}: ${resolution}` }, actor);
  }
  return { ok: true };
}

// What a claimed artist sees about their own profile over the last N days:
// page views, preview plays (and distinct listeners), new watchers and new
// backers. All first-party NEXT activity.
export async function getArtistProfileStats(artistId: number, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const one = async (sql: string, ...p: unknown[]) => ((await db.prepare(sql).get(...p)) as { c: number }).c;
  return {
    days,
    pageViews: await one(
      "SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'artist_detail_opened' AND created_at >= ? AND metadata IS NOT NULL AND (metadata::jsonb ->> 'artistId') = ?",
      since, String(artistId),
    ),
    previewPlays: await one("SELECT COUNT(*) AS c FROM preview_listens WHERE artist_id = ? AND event = 'started' AND created_at >= ?", artistId, since),
    listeners: await one("SELECT COUNT(DISTINCT user_id) AS c FROM preview_listens WHERE artist_id = ? AND event = 'started' AND created_at >= ?", artistId, since),
    newWatchers: await one('SELECT COUNT(*) AS c FROM next_watchlist WHERE artist_id = ? AND created_at >= ?', artistId, since),
    newBackers: await one('SELECT COUNT(*) AS c FROM next_founding_believers WHERE artist_id = ? AND purchased_at >= ?', artistId, since),
  };
}
