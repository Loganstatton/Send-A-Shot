import { db, isUniqueViolation } from './pg';
import { perRequest } from './request-cache';
import { breakoutScore } from './scoring';
import { toPublicArtist } from './public-artist';
import { applyTradeImpact, executionPriceCents, NEXT_STARTING_CREDITS_CENTS, nextBasePriceCents, quoteSell } from './next-market';
import { EARLY_DISCOVERY_RANK_THRESHOLD, scoutScore } from './scout-score';
import { getScoutBadges } from './scout-badges';
import { getCoordinatedPairFlags, getRapidTradingFlags, MarketTradeRow } from './market-integrity';
import type { DiscoveryRejectionBreakdown } from './discovery-source';
import {
  AgreementInput, Agreement, AnalyticsEvent, AnalyticsEventType, Artist, ArtistClaim, ArtistFieldChange, ArtistInput,
  DiscoveryCandidate, DiscoveryCandidateHistoryEntry, DiscoveryCandidateStatus, DiscoveryLeaderboardEntry, DiscoveryRun,
  DiscoverySourceKey, ErrorReport,
  DueFollowUp, FavoriteGenre, FeedEvent, FeedEventType, FeedReaction, FeedUserPost, FoundingBelieverRecord,
  GenreLeaderboardEntry, InvestmentEntry, InvestmentEntryInput, LeaderboardEntry, LeaderboardWindow, LogEntry,
  LogEntryInput, NextHolding, NextMarketRow, NextPricePoint, NextTransaction, NextTransactionType, PortfolioValue,
  ReactionType, RevenueEntry, RevenueEntryInput, RevenueSource, Role, SCORE_WEIGHTS, ScoreChange, ScoreSnapshot, ScoutDiscoveryEntry,
  ScoutProfile, SuspiciousTradingFlag,
  Stage, SyncFailure, SyncRun, SyncSourceKey, User, WatchlistEntry,
} from './types';

export type Actor = { id: number; name: string };

// The schema itself lives in lib/db-schema.ts (versioned migrations) and
// the connection/placeholder/transaction plumbing in lib/pg.ts. `db` is
// re-exported for the few callers that run their own one-off query.
export { db };

const ARTIST_SELECT = `
  SELECT artists.*, users.name AS created_by_name
  FROM artists
  LEFT JOIN users ON users.id = artists.created_by
`;

export async function getAllArtists(): Promise<Artist[]> {
  return await db.prepare(`${ARTIST_SELECT} ORDER BY artists.updated_at DESC`).all() as Artist[];
}

export async function getArtist(id: number): Promise<Artist | undefined> {
  return await db.prepare(`${ARTIST_SELECT} WHERE artists.id = ?`).get(id) as Artist | undefined;
}

// Case-insensitive exact-name lookup, used to flag (not block) a likely
// duplicate at creation time — two different real artists can legitimately
// share a name, so this is a heads-up for the Scout to double-check, not an
// enforced constraint like the soundcharts_uuid unique index above.
export async function findArtistsByName(name: string): Promise<{ id: number; name: string; stage: string }[]> {
  return await db.prepare('SELECT id, name, stage FROM artists WHERE LOWER(name) = LOWER(?)').all(name.trim()) as { id: number; name: string; stage: string }[];
}

const WRITABLE_FIELDS = [
  'name', 'stage', 'genre', 'location', 'scout_name',
  'tiktok_url', 'instagram_url', 'youtube_url', 'spotify_url', 'soundcloud_url', 'website_url',
  'followers_count', 'monthly_listeners', 'growth_velocity_pct', 'engagement_rate_pct',
  'music_talent', 'growth_velocity', 'engagement_quality', 'original_song_response',
  'brand_personality', 'content_consistency', 'commercial_potential', 'professionalism',
  'notes', 'photo_url', 'bio', 'top_song_url', 'song_preview_url', 'why_trending', 'soundcharts_uuid',
  'featured_video_id', 'high_rating_note',
  // Photo provenance a Scout sets alongside photo_url (manual paste ->
  // 'SCOUT_MANUAL'; the Commons picker fills all five at once with
  // 'WIKIMEDIA_COMMONS' — see components/WikimediaCommonsSearch.tsx).
  // Deliberately NOT here: photo_uploaded_by_user_id/photo_uploaded_at/
  // photo_rights_confirmed_at (ARTIST_PROVIDED only, set exclusively by
  // setArtistPhotoByOwner below — never client-settable, same reasoning as
  // claimed_by_user_id above) and wikidata_qid/wikidata_fetched_at/
  // wikidata_no_match_at (system-stamped only by the Wikidata lookup route).
  'photo_source_type', 'photo_source_url', 'photo_attribution', 'photo_license', 'photo_license_url',
] as const;

// Pre-beta migration: growth_velocity/engagement_quality used to be
// silently re-derived from growth_velocity_pct/engagement_rate_pct (a
// Soundcharts-shaped metric) on every save via growthVelocityScore()/
// engagementQualityScore() — removed from lib/scoring.ts entirely (dead
// code once nothing called them). They're now ordinary Scout-manual 0-10
// categories, same as the other six (ArtistForm.tsx
// rates them with the same slider). This does NOT reset or touch any
// artist's existing stored value — whatever was last computed/saved stays
// exactly as-is until a Scout deliberately edits it. The *_pct columns
// stay in the schema (legacy context a Scout can still see/edit) but no
// longer drive anything automatically.
const SCORE_FIELD_SET = new Set(Object.keys(SCORE_WEIGHTS));
const INTEGER_ARTIST_FIELDS = new Set<string>(['followers_count', 'monthly_listeners']);
const DECIMAL_ARTIST_FIELDS = new Set<string>(['growth_velocity_pct', 'engagement_rate_pct']);

// Every artist write (Scout form, bulk add, sync routes, discovery approval,
// claimed-artist edits) passes each value through here. The database's
// numeric columns only accept real numbers, and the Breakout Score formula
// assumes each of the eight ratings is 0-10 — so that is enforced in this
// one place instead of trusting every caller: a rating is clamped to 0-10
// (anything unreadable counts as 0), a count is a whole number >= 0, and a
// blank or unreadable count/percentage is stored as "unknown" (NULL).
function normalizeArtistValue(field: string, value: unknown): unknown {
  if (SCORE_FIELD_SET.has(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
  }
  if (INTEGER_ARTIST_FIELDS.has(field) || DECIMAL_ARTIST_FIELDS.has(field)) {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return INTEGER_ARTIST_FIELDS.has(field) ? Math.max(0, Math.round(n)) : n;
  }
  return value ?? null;
}

export async function createArtist(input: ArtistInput, actor?: Actor | null): Promise<Artist> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { created_at: now, updated_at: now, created_by: actor?.id ?? null };
  for (const field of WRITABLE_FIELDS) {
    const value = (input as any)[field];
    if (value != null) row[field] = normalizeArtistValue(field, value);
    else if (field === 'stage') row[field] = 'watchlist';
    else if (SCORE_FIELD_SET.has(field)) row[field] = 0;
    else row[field] = null;
  }

  const columns = ['created_at', 'updated_at', 'created_by', ...WRITABLE_FIELDS];
  const placeholders = columns.map((c) => `@${c}`).join(', ');
  const info = await db
    .prepare(`INSERT INTO artists (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(row);
  const artist = (await getArtist(info.lastInsertRowid as number))!;
  await snapshotScore(artist);
  return artist;
}

export async function updateArtist(id: number, input: ArtistInput, actor?: Actor | null): Promise<Artist | undefined> {
  const existing = await getArtist(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const sets: string[] = [];
  const row: Record<string, unknown> = { id, updated_at: now };
  for (const field of WRITABLE_FIELDS) {
    if (field in input) {
      sets.push(`${field} = @${field}`);
      row[field] = normalizeArtistValue(field, (input as any)[field]);
    }
  }
  if (sets.length > 0) {
    await db.prepare(`UPDATE artists SET updated_at = @updated_at, ${sets.join(', ')} WHERE id = @id`).run(row);
  }
  const updated = (await getArtist(id))!;
  if (input.stage && input.stage !== existing.stage) {
    await addLogEntry(id, {
      type: 'status_change',
      message: `Stage changed from "${existing.stage}" to "${updated.stage}"`,
    }, actor);
  }
  // Field-level audit trail — only for a real human edit (an automated
  // sync route never passes an actor), and never for 'stage' (already
  // covered by the status_change log entry above).
  if (sets.length > 0 && actor?.id != null) {
    await logArtistFieldChanges(id, existing, input, actor.id);
  }
  if (sets.length > 0) await snapshotScore(updated);
  return updated;
}

// null/undefined/'' all mean "no value" — ArtistForm always submits every
// field on every save (an untouched optional field comes through as '',
// never omitted), so comparing raw values against the DB's null would log
// a spurious "changed" row for every blank field on every single save.
function normalizeFieldValue(v: unknown): string | null {
  return v == null || v === '' ? null : String(v);
}

async function logArtistFieldChanges(artistId: number, existing: Artist, input: ArtistInput, actorId: number): Promise<void> {
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO artist_field_history (artist_id, field, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const field of WRITABLE_FIELDS) {
    if (field === 'stage' || !(field in input)) continue;
    const oldValue = normalizeFieldValue((existing as any)[field]);
    const newValue = normalizeFieldValue((input as any)[field]);
    if (oldValue === newValue) continue;
    await insert.run(artistId, field, oldValue, newValue, actorId, now);
  }
}

export async function getArtistFieldHistory(artistId: number, limit = 50): Promise<ArtistFieldChange[]> {
  return await db
    .prepare(`
      SELECT artist_field_history.*, users.name AS actor_name
      FROM artist_field_history
      LEFT JOIN users ON users.id = artist_field_history.actor_id
      WHERE artist_id = ?
      ORDER BY artist_field_history.created_at DESC, artist_field_history.id DESC
      LIMIT ?
    `)
    .all(artistId, limit) as ArtistFieldChange[];
}

// The exact profile fields an approved claimed artist can edit themselves
// (pre-beta migration brief item 3) — bio, discovery-relevant descriptors,
// their own official links, and which of their own videos NEXT features.
// Deliberately excludes everything else WRITABLE_FIELDS allows a Scout to
// touch: scout_name, notes, high_rating_note, the 8 rating categories,
// stage, follower/growth numbers, soundcharts_uuid, photo provenance (photo
// goes through the separate rights-confirmed setArtistPhotoByOwner instead
// of this generic path) — i.e. no internal discovery info, no scoring, no
// market-moving fields. name is also excluded: renaming a roster artist is
// still a Scout call (their own market visibility/NEXT ticker depends on
// it), not something an artist can silently redo on themselves.
const CLAIMED_ARTIST_EDITABLE_FIELDS = [
  'bio', 'genre', 'location', 'website_url',
  'tiktok_url', 'instagram_url', 'youtube_url', 'spotify_url', 'soundcloud_url',
  'featured_video_id',
] as const satisfies readonly (typeof WRITABLE_FIELDS)[number][];

// Applies a claimed artist's own edit to their own roster row — same
// updateArtist()/field-history/audit-log machinery a Scout's PATCH uses,
// just pre-filtered to CLAIMED_ARTIST_EDITABLE_FIELDS so nothing outside
// that whitelist can be smuggled in even if the request body contains it.
// Caller (app/api/next/my-artist/[id]/profile/route.ts) has already
// confirmed artist.claimed_by_user_id === the acting user.
export async function updateArtistByOwner(artistId: number, input: ArtistInput, actor: Actor): Promise<Artist | undefined> {
  const filtered: Record<string, unknown> = {};
  for (const field of CLAIMED_ARTIST_EDITABLE_FIELDS) {
    if (field in input) filtered[field] = (input as any)[field];
  }
  // updateArtist only ever writes a WRITABLE_FIELDS key actually present on
  // the input object (`field in input`) — `name` being structurally
  // required by ArtistInput's type is a compile-time-only constraint, never
  // checked at runtime, so omitting it here is safe: nothing renames the
  // artist through this path.
  return await updateArtist(artistId, filtered as ArtistInput, actor);
}

// "Most recent activity" for roster sorting — the later of the artist's
// own last field edit (updated_at) and its most recent contact_log entry
// (a note/outreach/meeting logged with no field actually changing doesn't
// touch updated_at at all, so relying on updated_at alone would miss it).
// Both are ISO strings, so GREATEST() below picks whichever sorts later,
// applied to the aggregate MAX() of each artist's log entries.
export async function getArtistLastActivityMap(): Promise<Map<number, string>> {
  const rows = await db
    .prepare(`
      SELECT artists.id AS id, GREATEST(artists.updated_at, COALESCE(MAX(contact_log.created_at), '')) AS last_activity_at
      FROM artists
      LEFT JOIN contact_log ON contact_log.artist_id = artists.id
      GROUP BY artists.id
    `)
    .all() as { id: number; last_activity_at: string }[];
  return new Map(rows.map((r) => [r.id, r.last_activity_at]));
}

export async function bulkSetArtistStage(ids: number[], stage: Stage, actor: Actor): Promise<number> {
  let updated = 0;
  for (const id of ids) {
    if (await updateArtist(id, { stage } as ArtistInput, actor)) updated++;
  }
  return updated;
}

export async function deleteArtist(id: number): Promise<boolean> {
  const info = await db.prepare('DELETE FROM artists WHERE id = ?').run(id);
  return info.changes > 0;
}

async function snapshotScore(artist: Artist) {
  await db.prepare(`
    INSERT INTO score_history (
      artist_id, recorded_at, stage, breakout_score,
      followers_count, monthly_listeners, growth_velocity_pct, engagement_rate_pct,
      music_talent, growth_velocity, engagement_quality, original_song_response,
      brand_personality, content_consistency, commercial_potential, professionalism
    ) VALUES (
      @artist_id, @recorded_at, @stage, @breakout_score,
      @followers_count, @monthly_listeners, @growth_velocity_pct, @engagement_rate_pct,
      @music_talent, @growth_velocity, @engagement_quality, @original_song_response,
      @brand_personality, @content_consistency, @commercial_potential, @professionalism
    )
  `).run({
    artist_id: artist.id,
    recorded_at: new Date().toISOString(),
    stage: artist.stage,
    breakout_score: breakoutScore(artist),
    followers_count: artist.followers_count ?? null,
    monthly_listeners: artist.monthly_listeners ?? null,
    growth_velocity_pct: artist.growth_velocity_pct ?? null,
    engagement_rate_pct: artist.engagement_rate_pct ?? null,
    music_talent: artist.music_talent,
    growth_velocity: artist.growth_velocity,
    engagement_quality: artist.engagement_quality,
    original_song_response: artist.original_song_response,
    brand_personality: artist.brand_personality,
    content_consistency: artist.content_consistency,
    commercial_potential: artist.commercial_potential,
    professionalism: artist.professionalism,
  });
}

// Batch form of getScoreHistory: full history for many artists in one
// query, oldest first per artist.
export async function getScoreHistories(artistIds: number[]): Promise<Map<number, ScoreSnapshot[]>> {
  const unique = [...new Set(artistIds)];
  const result = new Map<number, ScoreSnapshot[]>();
  if (unique.length === 0) return result;
  const rows = (await db
    .prepare(`SELECT * FROM score_history WHERE artist_id IN (${unique.map(() => '?').join(',')}) ORDER BY recorded_at ASC, id ASC`)
    .all(...unique)) as ScoreSnapshot[];
  for (const row of rows) {
    const list = result.get(row.artist_id) ?? [];
    list.push(row);
    result.set(row.artist_id, list);
  }
  return result;
}

export async function getScoreHistory(artistId: number): Promise<ScoreSnapshot[]> {
  return await db
    .prepare('SELECT * FROM score_history WHERE artist_id = ? ORDER BY recorded_at ASC')
    .all(artistId) as ScoreSnapshot[];
}

// The earliest/latest score_history row per artist — the "was Scout right"
// report's two endpoints (a Scout's first-ever rating vs. the most
// recently observed real growth). A self-join on MIN/MAX(recorded_at)
// rather than a window function — simple, and fast at this table's size.
export async function getEarliestScoreSnapshots(): Promise<ScoreSnapshot[]> {
  return await db
    .prepare(`
      SELECT score_history.* FROM score_history
      INNER JOIN (SELECT artist_id, MIN(recorded_at) AS snapshot_at FROM score_history GROUP BY artist_id) first_snapshot
        ON score_history.artist_id = first_snapshot.artist_id AND score_history.recorded_at = first_snapshot.snapshot_at
    `)
    .all() as ScoreSnapshot[];
}

export async function getLatestScoreSnapshots(): Promise<ScoreSnapshot[]> {
  return await db
    .prepare(`
      SELECT score_history.* FROM score_history
      INNER JOIN (SELECT artist_id, MAX(recorded_at) AS snapshot_at FROM score_history GROUP BY artist_id) latest_snapshot
        ON score_history.artist_id = latest_snapshot.artist_id AND score_history.recorded_at = latest_snapshot.snapshot_at
    `)
    .all() as ScoreSnapshot[];
}

export async function getArtistLog(artistId: number): Promise<LogEntry[]> {
  return await db
    .prepare('SELECT * FROM contact_log WHERE artist_id = ? ORDER BY created_at DESC')
    .all(artistId) as LogEntry[];
}

// Single-row lookup by contact_log id — NEXT Feed's artist_update events
// point at one via ref_id and need to render its message, not the whole
// artist's log.
export async function getLogEntryById(id: number): Promise<LogEntry | undefined> {
  return await db.prepare('SELECT * FROM contact_log WHERE id = ?').get(id) as LogEntry | undefined;
}

export async function addLogEntry(artistId: number, input: LogEntryInput, actor?: Actor | { name: string } | null): Promise<LogEntry> {
  const now = new Date().toISOString();
  const actorId = actor && 'id' in actor ? actor.id : null;
  const info = await db
    .prepare('INSERT INTO contact_log (artist_id, created_at, type, message, author, user_id, follow_up_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(artistId, now, input.type, input.message, actor?.name ?? null, actorId, input.follow_up_at ?? null);
  return await db.prepare('SELECT * FROM contact_log WHERE id = ?').get(info.lastInsertRowid) as LogEntry;
}

export async function deleteLogEntry(artistId: number, logId: number): Promise<boolean> {
  const info = await db
    .prepare('DELETE FROM contact_log WHERE id = ? AND artist_id = ?')
    .run(logId, artistId);
  return info.changes > 0;
}

// Clears (or sets) the follow-up date on a log entry — used to "check off" a
// due follow-up once it's been handled, without deleting the entry itself.
export async function setFollowUp(artistId: number, logId: number, followUpAt: string | null): Promise<LogEntry | undefined> {
  const info = await db
    .prepare('UPDATE contact_log SET follow_up_at = ? WHERE id = ? AND artist_id = ?')
    .run(followUpAt, logId, artistId);
  if (info.changes === 0) return undefined;
  return await db.prepare('SELECT * FROM contact_log WHERE id = ?').get(logId) as LogEntry;
}

export async function getDueFollowUps(): Promise<DueFollowUp[]> {
  return await db.prepare(`
    SELECT contact_log.id, contact_log.artist_id, artists.name AS artist_name,
      contact_log.type, contact_log.message, contact_log.follow_up_at, contact_log.created_at
    FROM contact_log
    JOIN artists ON artists.id = contact_log.artist_id
    WHERE contact_log.follow_up_at IS NOT NULL
      AND contact_log.follow_up_at <= ?
      AND artists.stage != 'passed'
    ORDER BY contact_log.follow_up_at ASC
  `).all(new Date().toISOString().slice(0, 10)) as DueFollowUp[];
}

const USER_COLUMNS =
  'id, created_at, name, email, role, next_credits_cents, next_onboarded_at, avatar_url, email_verified_at, tos_accepted_at, privacy_accepted_at, ' +
  'show_positions_publicly, notify_watchlist_moves, notify_new_artists, notify_founding_believer, notify_portfolio_milestones, ' +
  'notify_leaderboard_rank, email_notifications_enabled, notifications_emailed_through, last_login_at';

const BOOLEAN_USER_COLUMNS = [
  'show_positions_publicly', 'notify_watchlist_moves', 'notify_new_artists', 'notify_founding_believer',
  'notify_portfolio_milestones', 'notify_leaderboard_rank', 'email_notifications_enabled',
] as const;

// These flags are stored as 0/1 integers — normalizes each into
// the booleans the User type promises. Applied at every USER_COLUMNS read
// site so nothing downstream has to remember which columns are numbers.
function normalizeUser<T extends Record<(typeof BOOLEAN_USER_COLUMNS)[number], unknown>>(row: T): T {
  const normalized = { ...row };
  for (const field of BOOLEAN_USER_COLUMNS) (normalized as any)[field] = row[field] === 1;
  return normalized;
}

// New accounts always start as 'public' — internal/admin is never
// self-selected, only granted via setUserRole (an admin) or the
// ADMIN_EMAILS bootstrap in lib/auth.ts. tos_accepted_at/privacy_accepted_at
// are set here, at signup, not editable afterward — they're a one-time
// record of "the terms shown at signup time were accepted," not a
// re-checkable settings toggle.
export async function createUser(input: { name: string; email: string; password_hash: string }): Promise<User> {
  const now = new Date().toISOString();
  const info = await db
    .prepare(
      "INSERT INTO users (created_at, name, email, password_hash, role, tos_accepted_at, privacy_accepted_at) VALUES (?, ?, ?, ?, 'public', ?, ?)"
    )
    .run(now, input.name, input.email.toLowerCase(), input.password_hash, now, now);
  return (await getUserById(info.lastInsertRowid as number))!;
}

// Name and avatar are the only self-editable profile fields — email and
// password go through their own dedicated, more careful flows (change
// password needs the current password; changing email isn't built yet).
// The boolean notification-preference columns — looped over generically
// in updateUserProfile below instead of six near-identical if-blocks.
const NOTIFICATION_PREF_FIELDS = [
  'notify_watchlist_moves', 'notify_new_artists', 'notify_founding_believer',
  'notify_portfolio_milestones', 'notify_leaderboard_rank', 'email_notifications_enabled',
] as const;
type NotificationPrefField = (typeof NOTIFICATION_PREF_FIELDS)[number];

export async function updateUserProfile(
  userId: number,
  input: { name?: string; avatar_url?: string | null; show_positions_publicly?: boolean } & Partial<Record<NotificationPrefField, boolean>>
): Promise<User | undefined> {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: userId };
  if (input.name != null) {
    sets.push('name = @name');
    params.name = input.name;
  }
  if ('avatar_url' in input) {
    sets.push('avatar_url = @avatar_url');
    params.avatar_url = input.avatar_url || null;
  }
  if (input.show_positions_publicly != null) {
    sets.push('show_positions_publicly = @show_positions_publicly');
    params.show_positions_publicly = input.show_positions_publicly ? 1 : 0;
  }
  for (const field of NOTIFICATION_PREF_FIELDS) {
    if (input[field] != null) {
      sets.push(`${field} = @${field}`);
      params[field] = input[field] ? 1 : 0;
    }
  }
  if (sets.length === 0) return await getUserById(userId);
  await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return await getUserById(userId);
}

export async function updateUserPasswordHash(userId: number, password_hash: string): Promise<void> {
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, userId);
}

// The notification center's read/dismiss state — see the notification_reads
// table comment. All computed notification content lives in
// lib/notifications.ts; this file only ever stores/reads the key.
export async function getReadNotificationKeys(userId: number): Promise<Set<string>> {
  const rows = await db.prepare('SELECT notification_key FROM notification_reads WHERE user_id = ?').all(userId) as { notification_key: string }[];
  return new Set(rows.map((r) => r.notification_key));
}

export async function markNotificationRead(userId: number, key: string): Promise<void> {
  await markNotificationsRead(userId, [key]);
}

// One multi-row INSERT however many keys there are. ON CONFLICT DO NOTHING:
// marking an already-read notification read again is a no-op, not an error.
export async function markNotificationsRead(userId: number, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const now = new Date().toISOString();
  const values = keys.map(() => '(?, ?, ?)').join(', ');
  await db
    .prepare(`INSERT INTO notification_reads (user_id, notification_key, created_at) VALUES ${values} ON CONFLICT DO NOTHING`)
    .run(...keys.flatMap((key) => [userId, key, now]));
}

// A cursor, not a send-log: "everything at or before this timestamp has
// already been emailed." Simpler than tracking per-notification send state,
// and sufficient since email is a digest of what's new, not a guaranteed
// per-item delivery record.
export async function setNotificationsEmailedThrough(userId: number, iso: string): Promise<void> {
  await db.prepare('UPDATE users SET notifications_emailed_through = ? WHERE id = ?').run(iso, userId);
}

// Idempotent — verifying an already-verified email is a harmless no-op,
// not an error (a user clicking an old email link twice shouldn't see one).
export async function markEmailVerified(userId: number): Promise<User | undefined> {
  await db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(new Date().toISOString(), userId);
  return await getUserById(userId);
}

// Every table that stores a user's own NEXT activity (holdings,
// transactions, founding-believer records, watchlist) is ON DELETE CASCADE;
// Scout-side attribution (created_by, reviewed_by) is ON DELETE SET NULL,
// so a deleted user's Scout history stays intact but anonymized. A plain
// DELETE here is safe as-is — see the FK definitions above.
export async function deleteUser(userId: number): Promise<void> {
  await db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

export async function getUserByEmail(email: string): Promise<(User & { password_hash: string }) | undefined> {
  const row = await db
    .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
    .get(email.toLowerCase()) as (User & { password_hash: string }) | undefined;
  return row && normalizeUser(row);
}

// The casual, no-new-infrastructure half of "prevent self-created duplicate
// accounts" — catches the most common trivial-alias trick (Gmail's
// dot-insensitivity and the universal +tag convention most providers
// support), not a real identity check. Someone determined enough to use an
// entirely different mailbox is still outside what an email address alone
// can ever prove; real device/IP-based duplicate detection would need new
// instrumentation this app doesn't collect today.
export function normalizeEmailForDuplicateCheck(email: string): string {
  const lower = email.trim().toLowerCase();
  const [local, domain] = lower.split('@');
  if (!domain) return lower;
  const noTag = local.split('+')[0];
  const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';
  return `${isGmail ? noTag.replace(/\./g, '') : noTag}@${domain}`;
}

// Scans every existing account for one whose email normalizes to the same
// address — see normalizeEmailForDuplicateCheck. A full-table scan, same
// tradeoff getScoutLeaderboard's getAllUsers().map() already makes at this
// app's current scale; there's no index to build this against since it's
// not a stored column, just a signup-time check.
export async function findUserByNormalizedEmail(email: string): Promise<User | undefined> {
  const target = normalizeEmailForDuplicateCheck(email);
  return (await getAllUsers()).find((u) => normalizeEmailForDuplicateCheck(u.email) === target);
}

export async function getUserById(id: number): Promise<User | undefined> {
  const row = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as User | undefined;
  return row && normalizeUser(row);
}

// Batch actor-name lookup for NEXT Feed — a page of feed_events can name a
// handful of distinct actors (early_discovery submitters, founding-believer
// sharers), and this resolves all of them in one query instead of one
// getUserById call per event.
export async function getUsersByIds(ids: number[]): Promise<Map<number, User>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id IN (${placeholders})`).all(...unique) as User[];
  return new Map(rows.map((r) => [r.id, normalizeUser(r)]));
}

// Server-only, used solely by the change-password route to verify the
// caller's current password before accepting a new one — never exposed on
// the public User type.
export async function getUserPasswordHash(id: number): Promise<string | undefined> {
  return (await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as { password_hash: string } | undefined)?.password_hash;
}

export async function getAllUsers(): Promise<User[]> {
  return (await db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC`).all() as User[]).map(normalizeUser);
}

// The only way a user's role changes after signup — called by an admin-only
// route, or by the ADMIN_EMAILS bootstrap. Never reachable from a public
// user's own account settings.
export async function setUserRole(userId: number, role: Role): Promise<User | undefined> {
  const info = await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  if (info.changes === 0) return undefined;
  return await getUserById(userId);
}

// Marks the first-login NEXT walkthrough as seen. Idempotent by design —
// once set, it's never cleared or re-triggered automatically, so a user
// only ever sees the full walkthrough once (contextual InfoTips are how
// they get reminded of what a term means after that).
export async function completeNextOnboarding(userId: number): Promise<User | undefined> {
  const info = await db.prepare('UPDATE users SET next_onboarded_at = ? WHERE id = ? AND next_onboarded_at IS NULL').run(new Date().toISOString(), userId);
  // Only a genuine first completion (the WHERE guard actually matched)
  // counts as the analytics event — a client retrying this idempotent call
  // shouldn't inflate the funnel.
  if (info.changes > 0) await logEvent(userId, 'onboarding_completed');
  return await getUserById(userId);
}

const AGREEMENT_SELECT = `
  SELECT agreements.*, users.name AS created_by_name
  FROM agreements
  LEFT JOIN users ON users.id = agreements.created_by
`;

export async function getAgreements(artistId: number): Promise<Agreement[]> {
  return await db
    .prepare(`${AGREEMENT_SELECT} WHERE agreements.artist_id = ? ORDER BY agreements.created_at DESC`)
    .all(artistId) as Agreement[];
}

export async function getAgreement(artistId: number, agreementId: number): Promise<Agreement | undefined> {
  return await db
    .prepare(`${AGREEMENT_SELECT} WHERE agreements.artist_id = ? AND agreements.id = ?`)
    .get(artistId, agreementId) as Agreement | undefined;
}

const AGREEMENT_WRITABLE_FIELDS = [
  'type', 'status', 'start_date', 'end_date', 'commission_pct',
  'sponsorship_commission_pct', 'touring_commission_pct', 'masters_owned_by',
  'investment_amount_cents', 'notes',
] as const;

export async function createAgreement(artistId: number, input: AgreementInput, actor?: Actor | null): Promise<Agreement> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    artist_id: artistId,
    created_at: now,
    updated_at: now,
    created_by: actor?.id ?? null,
    status: input.status ?? 'draft',
  };
  for (const field of AGREEMENT_WRITABLE_FIELDS) {
    if (field === 'status') continue;
    row[field] = (input as any)[field] ?? null;
  }
  const columns = ['artist_id', 'created_at', 'updated_at', 'created_by', ...AGREEMENT_WRITABLE_FIELDS];
  const placeholders = columns.map((c) => `@${c}`).join(', ');
  const info = await db
    .prepare(`INSERT INTO agreements (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(row);
  return (await getAgreement(artistId, info.lastInsertRowid as number))!;
}

export async function updateAgreement(artistId: number, agreementId: number, input: AgreementInput): Promise<Agreement | undefined> {
  if (!await getAgreement(artistId, agreementId)) return undefined;
  const now = new Date().toISOString();
  const sets: string[] = [];
  const row: Record<string, unknown> = { id: agreementId, updated_at: now };
  for (const field of AGREEMENT_WRITABLE_FIELDS) {
    if (field in input) {
      sets.push(`${field} = @${field}`);
      row[field] = (input as any)[field];
    }
  }
  if (sets.length > 0) {
    await db.prepare(`UPDATE agreements SET updated_at = @updated_at, ${sets.join(', ')} WHERE id = @id`).run(row);
  }
  return await getAgreement(artistId, agreementId);
}

export async function deleteAgreement(artistId: number, agreementId: number): Promise<boolean> {
  const info = await db
    .prepare('DELETE FROM agreements WHERE id = ? AND artist_id = ?')
    .run(agreementId, artistId);
  return info.changes > 0;
}

const REVENUE_SELECT = `
  SELECT revenue_entries.*, users.name AS created_by_name
  FROM revenue_entries
  LEFT JOIN users ON users.id = revenue_entries.created_by
`;

export async function getRevenueEntries(artistId: number): Promise<RevenueEntry[]> {
  return await db
    .prepare(`${REVENUE_SELECT} WHERE revenue_entries.artist_id = ? ORDER BY revenue_entries.recorded_at DESC`)
    .all(artistId) as RevenueEntry[];
}

// sponsorship_commission_pct / touring_commission_pct only need to be set
// when they differ from the agreement's default commission_pct — e.g. "15%
// standard, but 0% on touring." Unset (null) falls back to the default.
function resolveCommissionPct(agreement: Agreement | undefined, source: RevenueSource): number | null {
  if (!agreement) return null;
  if (source === 'sponsorship' && agreement.sponsorship_commission_pct != null) {
    return agreement.sponsorship_commission_pct;
  }
  if (source === 'shows' && agreement.touring_commission_pct != null) {
    return agreement.touring_commission_pct;
  }
  return agreement.commission_pct ?? null;
}

export async function createRevenueEntry(artistId: number, input: RevenueEntryInput, actor?: Actor | null): Promise<RevenueEntry> {
  const now = new Date().toISOString();
  const agreement = input.agreement_id ? await getAgreement(artistId, input.agreement_id) : undefined;
  const commissionPct = resolveCommissionPct(agreement, input.source);
  const commissionCents = commissionPct != null
    ? Math.round(input.gross_amount_cents * (commissionPct / 100))
    : null;

  const info = await db.prepare(`
    INSERT INTO revenue_entries (
      artist_id, agreement_id, created_at, recorded_at, source,
      gross_amount_cents, commission_pct_applied, commission_amount_cents, notes, created_by
    ) VALUES (
      @artist_id, @agreement_id, @created_at, @recorded_at, @source,
      @gross_amount_cents, @commission_pct_applied, @commission_amount_cents, @notes, @created_by
    )
  `).run({
    artist_id: artistId,
    agreement_id: input.agreement_id ?? null,
    created_at: now,
    recorded_at: input.recorded_at,
    source: input.source,
    gross_amount_cents: input.gross_amount_cents,
    commission_pct_applied: commissionPct,
    commission_amount_cents: commissionCents,
    notes: input.notes ?? null,
    created_by: actor?.id ?? null,
  });
  return await db
    .prepare(`${REVENUE_SELECT} WHERE revenue_entries.id = ?`)
    .get(info.lastInsertRowid) as RevenueEntry;
}

export async function deleteRevenueEntry(artistId: number, revenueId: number): Promise<boolean> {
  const info = await db
    .prepare('DELETE FROM revenue_entries WHERE id = ? AND artist_id = ?')
    .run(revenueId, artistId);
  return info.changes > 0;
}

const INVESTMENT_SELECT = `
  SELECT investment_entries.*, users.name AS created_by_name
  FROM investment_entries
  LEFT JOIN users ON users.id = investment_entries.created_by
`;

export async function getInvestmentEntries(artistId: number): Promise<InvestmentEntry[]> {
  return await db
    .prepare(`${INVESTMENT_SELECT} WHERE investment_entries.artist_id = ? ORDER BY investment_entries.recorded_at DESC`)
    .all(artistId) as InvestmentEntry[];
}

export async function createInvestmentEntry(artistId: number, input: InvestmentEntryInput, actor?: Actor | null): Promise<InvestmentEntry> {
  const now = new Date().toISOString();
  const info = await db.prepare(`
    INSERT INTO investment_entries (
      artist_id, agreement_id, created_at, recorded_at, category, amount_cents, notes, created_by
    ) VALUES (
      @artist_id, @agreement_id, @created_at, @recorded_at, @category, @amount_cents, @notes, @created_by
    )
  `).run({
    artist_id: artistId,
    agreement_id: input.agreement_id ?? null,
    created_at: now,
    recorded_at: input.recorded_at,
    category: input.category,
    amount_cents: input.amount_cents,
    notes: input.notes ?? null,
    created_by: actor?.id ?? null,
  });
  return await db
    .prepare(`${INVESTMENT_SELECT} WHERE investment_entries.id = ?`)
    .get(info.lastInsertRowid) as InvestmentEntry;
}

export async function deleteInvestmentEntry(artistId: number, investmentId: number): Promise<boolean> {
  const info = await db
    .prepare('DELETE FROM investment_entries WHERE id = ? AND artist_id = ?')
    .run(investmentId, artistId);
  return info.changes > 0;
}

export type PortfolioRow = {
  artist: Artist;
  score: number;
  scoreHistory: { recorded_at: string; breakout_score: number }[];
  changeAbs: number;
  changePct: number | null;
  hasComparison: boolean;
  totalInvestedCents: number;
  totalGrossCents: number;
  totalCommissionCents: number;
  roiPct: number | null;
};

// One row per tracked artist: current Breakout Score, its trend since the
// previous snapshot, and money in/out — the "stock screener" view across
// the whole roster instead of one artist at a time.
export async function getPortfolioSummary(): Promise<PortfolioRow[]> {
  const artists = await getAllArtists();

  const historyRows = await db
    .prepare('SELECT artist_id, recorded_at, breakout_score FROM score_history ORDER BY recorded_at ASC')
    .all() as { artist_id: number; recorded_at: string; breakout_score: number }[];
  const historyByArtist = new Map<number, { recorded_at: string; breakout_score: number }[]>();
  for (const row of historyRows) {
    const list = historyByArtist.get(row.artist_id) ?? [];
    list.push({ recorded_at: row.recorded_at, breakout_score: row.breakout_score });
    historyByArtist.set(row.artist_id, list);
  }

  // Actual categorized spend (marketing/studio/video/etc), not the
  // agreement's negotiated investment_amount_cents ceiling — this is what
  // ROI is measured against.
  const investedRows = await db
    .prepare('SELECT artist_id, SUM(amount_cents) as total FROM investment_entries GROUP BY artist_id')
    .all() as { artist_id: number; total: number }[];
  const investedByArtist = new Map(investedRows.map((r) => [r.artist_id, r.total]));

  const revenueRows = await db
    .prepare('SELECT artist_id, SUM(commission_amount_cents) as commission, SUM(gross_amount_cents) as gross FROM revenue_entries GROUP BY artist_id')
    .all() as { artist_id: number; commission: number | null; gross: number }[];
  const revenueByArtist = new Map(revenueRows.map((r) => [r.artist_id, r]));

  return artists.map((artist) => {
    const history = historyByArtist.get(artist.id) ?? [];
    const score = breakoutScore(artist);
    const previousScore = history.length >= 2 ? history[history.length - 2].breakout_score : null;
    const hasComparison = previousScore != null;
    const changeAbs = hasComparison ? Math.round((score - previousScore!) * 10) / 10 : 0;
    const changePct = hasComparison && previousScore !== 0
      ? Math.round((changeAbs / previousScore!) * 1000) / 10
      : null;
    const revenue = revenueByArtist.get(artist.id);
    const totalInvestedCents = investedByArtist.get(artist.id) ?? 0;
    const totalCommissionCents = revenue?.commission ?? 0;
    const roiPct = totalInvestedCents > 0
      ? Math.round(((totalCommissionCents - totalInvestedCents) / totalInvestedCents) * 1000) / 10
      : null;
    return {
      artist,
      score,
      scoreHistory: history,
      changeAbs,
      changePct,
      hasComparison,
      totalInvestedCents,
      totalGrossCents: revenue?.gross ?? 0,
      totalCommissionCents,
      roiPct,
    };
  });
}

// --- NEXT (public paper-trading product) ---

// Lazily sets an artist's starting NEXT Price the first time it's needed
// (from the score-based formula in lib/next-market), then leaves it alone —
// after that, price only moves via trades. Self-healing: works whether the
// artist was created before or after NEXT existed.
//
// The UPDATE is conditional on the price still being unset: two requests
// can reach this for the same brand-new artist at the same moment, and only
// the one whose UPDATE actually lands may write the opening history point —
// otherwise the chart would start with two.
async function ensureNextPrice(artist: Artist): Promise<number> {
  if (artist.next_current_price_cents != null) return artist.next_current_price_cents;
  const price = nextBasePriceCents(breakoutScore(artist));
  const info = await db
    .prepare('UPDATE artists SET next_current_price_cents = ? WHERE id = ? AND next_current_price_cents IS NULL')
    .run(price, artist.id);
  if (info.changes > 0) {
    await db.prepare('INSERT INTO next_price_history (artist_id, recorded_at, price_cents) VALUES (?, ?, ?)')
      .run(artist.id, new Date().toISOString(), price);
    return price;
  }
  const row = (await db.prepare('SELECT next_current_price_cents FROM artists WHERE id = ?').get(artist.id)) as
    | { next_current_price_cents: number | null }
    | undefined;
  return row?.next_current_price_cents ?? price;
}

// Price history for many artists in one query, oldest first per artist —
// what every market-row read below goes through, so loading the whole
// Discover grid costs one history query, not one per artist.
async function getNextPriceHistories(artistIds: number[]): Promise<Map<number, NextPricePoint[]>> {
  const result = new Map<number, NextPricePoint[]>();
  if (artistIds.length === 0) return result;
  const placeholders = artistIds.map(() => '?').join(',');
  const rows = (await db
    .prepare(`SELECT artist_id, recorded_at, price_cents FROM next_price_history WHERE artist_id IN (${placeholders}) ORDER BY recorded_at ASC, id ASC`)
    .all(...artistIds)) as { artist_id: number; recorded_at: string; price_cents: number }[];
  for (const row of rows) {
    const list = result.get(row.artist_id) ?? [];
    list.push({ recorded_at: row.recorded_at, price_cents: row.price_cents });
    result.set(row.artist_id, list);
  }
  return result;
}

// Turns raw artist rows into Public NEXT market rows. Prices are ensured
// first (a no-op for any artist that already has one) so a brand-new
// artist's opening price point is already in the history read after it.
async function toMarketRows(artists: Artist[]): Promise<NextMarketRow[]> {
  const prices = new Map<number, number>();
  for (const artist of artists) prices.set(artist.id, await ensureNextPrice(artist));
  const histories = await getNextPriceHistories(artists.map((a) => a.id));
  return artists.map((artist) => ({
    artist: toPublicArtist(artist),
    score: breakoutScore(artist),
    priceCents: prices.get(artist.id)!,
    priceHistory: histories.get(artist.id) ?? [],
  }));
}

// Returns Public NEXT's market rows — every artist row's own `.artist` is
// already narrowed to PublicArtist (see toPublicArtist/lib/public-artist.ts)
// before it leaves this function, since this is the data that gets passed
// straight into 'use client' components (ArtistCard, DiscoverGrid,
// FeaturedArtist, FeedCard) and serialized into the page's RSC payload.
// Server-only code that needs a raw Artist field (stage, Scout notes, the
// raw ScoreInputs categories, soundcharts_uuid, claimed_by_user_id, etc)
// must fetch it separately via getArtist()/getAllArtists() — never widen
// this function's return type to route around that.
export const getNextMarket = perRequest(async (): Promise<NextMarketRow[]> => {
  return await toMarketRows((await getAllArtists()).filter((a) => a.stage !== 'passed'));
});

// Batch sibling of getNextArtist — NEXT Feed needs live score/price context
// for a page of feed_events, which typically names far fewer distinct
// artists than the full roster getNextMarket() would load. One IN query
// for the artists themselves rather than N calls to getArtist. Same public
// projection as getNextMarket() above — see its comment.
export async function getNextArtistsByIds(ids: number[]): Promise<Map<number, NextMarketRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  const artists = (await db.prepare(`${ARTIST_SELECT} WHERE artists.id IN (${placeholders})`).all(...unique)) as Artist[];
  return new Map((await toMarketRows(artists)).map((row) => [row.artist.id, row]));
}

// The "listen" half of NEXT's music experience — see the preview_listens
// table comment. 'started' logs every time playback begins (a replay
// counts again — "every listen event," not "every unique listener").
export async function recordPreviewListen(userId: number, artistId: number, event: 'started' | 'completed'): Promise<void> {
  await db.prepare('INSERT INTO preview_listens (user_id, artist_id, event, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, artistId, event, new Date().toISOString());
}

// Used by executeTrade to stamp "did this trader listen before backing
// this artist" onto the buy transaction — any 'started' event for this
// user+artist recorded before this call is a real prior listen.
export async function hasListenedToArtist(userId: number, artistId: number): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM preview_listens WHERE user_id = ? AND artist_id = ? AND event = 'started' LIMIT 1").get(userId, artistId);
  return row != null;
}

// Global counts, not scoped to one user — powers Discover's "Most watched"
// / "Most backed" sorts. One GROUP BY each rather than a per-artist query,
// so sorting the whole market by either costs 2 queries total, not 2*N.
export async function getWatchCountsByArtist(): Promise<Record<number, number>> {
  const rows = await db.prepare('SELECT artist_id, COUNT(*) AS c FROM next_watchlist GROUP BY artist_id').all() as { artist_id: number; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.artist_id, r.c]));
}

// "Backed" means currently holding shares (shares > 0) — someone who sold
// out entirely no longer counts, same as how the Trade panel's own
// "Shares owned" would read 0 for them.
export async function getBackerCountsByArtist(): Promise<Record<number, number>> {
  const rows = await db
    .prepare('SELECT artist_id, COUNT(DISTINCT user_id) AS c FROM next_holdings WHERE shares > 0 GROUP BY artist_id')
    .all() as { artist_id: number; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.artist_id, r.c]));
}

// Same public projection as getNextMarket() above (see its comment) — a
// server component that needs raw Artist fields alongside this (e.g. the
// claim-owner check or scoreContributors() on Artist Detail) should call
// getArtist(artistId) itself for those, not expect this function to widen.
export async function getNextArtist(artistId: number): Promise<NextMarketRow | undefined> {
  const artist = await getArtist(artistId);
  if (!artist) return undefined;
  return (await toMarketRows([artist]))[0];
}

export async function getHolding(userId: number, artistId: number): Promise<NextHolding | undefined> {
  return (await db
    .prepare('SELECT * FROM next_holdings WHERE user_id = ? AND artist_id = ?')
    .get(userId, artistId)) as NextHolding | undefined;
}

export async function getUserHoldings(
  userId: number
): Promise<(NextHolding & { artist_name: string; artist_photo_url?: string; price_cents: number; exitValueCents: number })[]> {
  const rows = (await db.prepare(`
    SELECT next_holdings.*, artists.name AS artist_name, artists.photo_url AS artist_photo_url,
           artists.next_current_price_cents AS current_price_cents
    FROM next_holdings
    JOIN artists ON artists.id = next_holdings.artist_id
    WHERE next_holdings.user_id = ? AND next_holdings.shares > 0
    ORDER BY next_holdings.updated_at DESC
  `).all(userId)) as (NextHolding & { artist_name: string; artist_photo_url?: string; current_price_cents: number | null })[];
  const holdings = [];
  for (const { current_price_cents, ...row } of rows) {
    // A held position always has a price (the buy that created it set one);
    // the fallback only covers a row written before NEXT prices existed.
    const priceCents = current_price_cents ?? (await ensureNextPrice((await getArtist(row.artist_id))!));
    // The position's realistic exit value — what selling the WHOLE holding
    // right now would actually net (see quoteSell's own comment). This,
    // not shares * priceCents, is what "unrealized P&L" should be measured
    // against: priceCents already includes any impact this same trader's
    // own last buy caused, which a sell of comparable size mostly reverses.
    const exitValueCents = quoteSell(priceCents, row.shares).proceedsCents;
    holdings.push({ ...row, price_cents: priceCents, exitValueCents });
  }
  return holdings;
}

// A bookmark with no credits spent — tracking an artist without owning
// shares. Deliberately separate from next_holdings: watching and backing
// are different actions, and an artist can be watched with zero position.
export async function isWatchlisted(userId: number, artistId: number): Promise<boolean> {
  return await db.prepare('SELECT 1 FROM next_watchlist WHERE user_id = ? AND artist_id = ?').get(userId, artistId) != null;
}

export async function addToWatchlist(userId: number, artistId: number): Promise<void> {
  await db.prepare('INSERT INTO next_watchlist (user_id, artist_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(userId, artistId, new Date().toISOString());
}

export async function removeFromWatchlist(userId: number, artistId: number): Promise<void> {
  await db.prepare('DELETE FROM next_watchlist WHERE user_id = ? AND artist_id = ?').run(userId, artistId);
}

export async function setWatchlistAlerts(userId: number, artistId: number, enabled: boolean): Promise<void> {
  await db.prepare('UPDATE next_watchlist SET alerts_enabled = ? WHERE user_id = ? AND artist_id = ?')
    .run(enabled ? 1 : 0, userId, artistId);
}

// Finds the most recent value at or before `at` from a series ordered
// oldest-first, falling back to the earliest ever recorded when everything
// on record postdates `at` (watched right as the first snapshot/price point
// landed) — the closest available reference rather than no comparison at
// all. Null only when the series is completely empty.
export function valueAtOrBefore<T>(series: T[], at: string, recordedAt: (item: T) => string): T | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (recordedAt(series[i]) <= at) return series[i];
  }
  return series[0] ?? null;
}

// Every artist the user is tracking, plus what changed since they added
// it: Score and Price as of the watch date, alongside where both stand
// now (row.score / row.priceCents already carry "now"). Powers the
// Watchlist page's "since you added" line and its alert highlighting.
// Market rows and score history are each loaded for the whole watchlist in
// one query, not once per watched artist.
export async function getUserWatchlist(userId: number): Promise<WatchlistEntry[]> {
  const watches = (await db
    .prepare('SELECT artist_id, created_at, alerts_enabled FROM next_watchlist WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)) as { artist_id: number; created_at: string; alerts_enabled: number }[];
  if (watches.length === 0) return [];

  const artistIds = watches.map((w) => w.artist_id);
  const markets = await getNextArtistsByIds(artistIds);
  const placeholders = artistIds.map(() => '?').join(',');
  const scoreRows = (await db
    .prepare(`SELECT artist_id, recorded_at, breakout_score FROM score_history WHERE artist_id IN (${placeholders}) ORDER BY recorded_at ASC, id ASC`)
    .all(...artistIds)) as { artist_id: number; recorded_at: string; breakout_score: number }[];
  const scoresByArtist = new Map<number, { recorded_at: string; breakout_score: number }[]>();
  for (const row of scoreRows) {
    const list = scoresByArtist.get(row.artist_id) ?? [];
    list.push(row);
    scoresByArtist.set(row.artist_id, list);
  }

  const entries: WatchlistEntry[] = [];
  for (const w of watches) {
    const market = markets.get(w.artist_id);
    if (!market) continue;
    const scoreSnapshot = valueAtOrBefore(scoresByArtist.get(w.artist_id) ?? [], w.created_at, (s) => s.recorded_at);
    const pricePoint = valueAtOrBefore(market.priceHistory, w.created_at, (p) => p.recorded_at);
    entries.push({
      ...market,
      watchedAt: w.created_at,
      alertsEnabled: w.alerts_enabled === 1,
      scoreAtWatch: scoreSnapshot?.breakout_score ?? null,
      priceAtWatchCents: pricePoint?.price_cents ?? null,
    });
  }
  return entries;
}

// Cheap id-only lookup for pages that just need to know which cards to mark
// as watched (Discover, Artist Detail) without loading full market rows.
export async function getWatchlistArtistIds(userId: number): Promise<number[]> {
  const rows = await db.prepare('SELECT artist_id FROM next_watchlist WHERE user_id = ? ORDER BY created_at DESC').all(userId) as { artist_id: number }[];
  return rows.map((r) => r.artist_id);
}

// The "backed" counterpart to getWatchlistArtistIds above — id-only, for
// NEXT Feed's Following tab (watched OR backed both count as "following").
// Currently holding shares, same definition getBackerCountsByArtist uses.
export async function getBackedArtistIds(userId: number): Promise<number[]> {
  const rows = await db.prepare('SELECT artist_id FROM next_holdings WHERE user_id = ? AND shares > 0').all(userId) as { artist_id: number }[];
  return rows.map((r) => r.artist_id);
}

// Score movement since the previous snapshot, for every artist that has
// one — one query for the whole roster (see getWatchCountsByArtist /
// getBackerCountsByArtist above for the same pattern) rather than N+1.
// Same definition the internal Screener uses for "momentum" already
// (getPortfolioSummary's changeAbs/hasComparison).
export async function getScoreChanges(): Promise<Record<number, ScoreChange>> {
  const rows = await db
    .prepare('SELECT artist_id, breakout_score FROM score_history ORDER BY recorded_at ASC')
    .all() as { artist_id: number; breakout_score: number }[];
  const byArtist = new Map<number, number[]>();
  for (const row of rows) {
    const list = byArtist.get(row.artist_id) ?? [];
    list.push(row.breakout_score);
    byArtist.set(row.artist_id, list);
  }
  const result: Record<number, ScoreChange> = {};
  for (const [artistId, scores] of byArtist) {
    if (scores.length < 2) continue;
    const changeAbs = Math.round((scores[scores.length - 1] - scores[scores.length - 2]) * 10) / 10;
    result[artistId] = { changeAbs, hasComparison: true };
  }
  return result;
}

// Records a permanent "you were early" snapshot the first time a user ever
// buys into an artist. UNIQUE(user_id, artist_id) makes this idempotent —
// safe to call on every buy — and the row is never updated or deleted after
// insert, including when the position is later sold down to zero.
async function recordFoundingBelieverIfFirstBuy(userId: number, artistId: number, artist: Artist, score: number, priceCents: number, now: string) {
  const { rank } = await db.prepare('SELECT COUNT(*) AS rank FROM next_founding_believers WHERE artist_id = ?').get(artistId) as { rank: number };
  await db.prepare(`
    INSERT INTO next_founding_believers
      (user_id, artist_id, purchased_at, followers_count, monthly_listeners, next_score, next_price_cents, discovery_rank)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `).run(userId, artistId, now, artist.followers_count ?? null, artist.monthly_listeners ?? null, score, priceCents, rank + 1);
}

export async function getFoundingBelieverRecord(userId: number, artistId: number): Promise<FoundingBelieverRecord | undefined> {
  return await db
    .prepare('SELECT * FROM next_founding_believers WHERE user_id = ? AND artist_id = ?')
    .get(userId, artistId) as FoundingBelieverRecord | undefined;
}

// Single-row lookup by id — NEXT Feed's founding_believer_share events
// point at one via ref_id and need its tier/rank to render the card.
export async function getFoundingBelieverRecordById(id: number): Promise<FoundingBelieverRecord | undefined> {
  return await db.prepare('SELECT * FROM next_founding_believers WHERE id = ?').get(id) as FoundingBelieverRecord | undefined;
}

// A user deliberately choosing to post their own collectible into the Feed
// — never automatic (see the FeedEvent type's comment: the spec is
// explicit that a card is never auto-posted just for existing). No
// metadata snapshot needed here at all: the referenced
// next_founding_believers row already permanently holds the "at time of
// backing" numbers (follower count, score, price, rank) a render would
// need — this event is purely a pointer plus a timestamp. dedupe_key
// allows one share per collectible per calendar day, so a doubled network
// request or an accidental double-tap can't post it twice, while a
// genuine re-share later (a real use case — "still proud of this one") stays possible.
export async function shareFoundingBelieverToFeed(userId: number, artistId: number): Promise<FeedEvent | null> {
  const record = await getFoundingBelieverRecord(userId, artistId);
  if (!record) return null;
  const today = new Date().toISOString().slice(0, 10);
  return await createFeedEvent({
    eventType: 'founding_believer_share',
    actorUserId: userId,
    artistId,
    refType: 'founding_believer',
    refId: record.id,
    dedupeKey: `founding_believer_share:${record.id}:${today}`,
  });
}

export async function getUserTransactions(userId: number, limit = 50): Promise<(NextTransaction & { artist_name: string })[]> {
  const rows = await db.prepare(`
    SELECT next_transactions.*, artists.name AS artist_name
    FROM next_transactions
    JOIN artists ON artists.id = next_transactions.artist_id
    WHERE next_transactions.user_id = ?
    ORDER BY next_transactions.created_at DESC
    LIMIT ?
  `).all(userId, limit) as (Omit<NextTransaction, 'listened_before_buy'> & { artist_name: string; listened_before_buy: number | null })[];
  // Stored as a 0/1/null integer — normalize it into the
  // boolean|undefined the NextTransaction type promises (undefined for
  // sells, where the column is never set, not a false "no" claim about
  // something that was never tracked for that row).
  return rows.map((r) => ({ ...r, listened_before_buy: r.type === 'buy' ? Boolean(r.listened_before_buy) : undefined }));
}

// "Volume" for the Trading panel's market-volume stat — total notional
// traded (both buys and sells, both count) in the window. credits_delta_cents
// is negative for a buy (credits spent) and positive for a sell (credits
// received); the absolute value of each is that trade's real dollar size.
export async function getArtistTradeVolumeCents(artistId: number, hours: number): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare('SELECT COALESCE(SUM(ABS(credits_delta_cents)), 0) AS volume FROM next_transactions WHERE artist_id = ? AND created_at >= ?')
    .get(artistId, cutoff) as { volume: number };
  return row.volume;
}

// Same volume calculation as getArtistTradeVolumeCents, but for an
// arbitrary [startHoursAgo, endHoursAgo) window instead of "since N hours
// ago" — lets a caller compare two equal-length adjacent windows (e.g. this
// week vs the week before) for a real week-over-week % change. See
// lib/feed-signals.ts's NEXT Volume signal.
export async function getArtistTradeVolumeCentsInWindow(artistId: number, startHoursAgo: number, endHoursAgo: number): Promise<number> {
  const start = new Date(Date.now() - startHoursAgo * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() - endHoursAgo * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare('SELECT COALESCE(SUM(ABS(credits_delta_cents)), 0) AS volume FROM next_transactions WHERE artist_id = ? AND created_at >= ? AND created_at < ?')
    .get(artistId, start, end) as { volume: number };
  return row.volume;
}

// Distinct traders who backed (bought) this artist within the window —
// "number of people who backed the artist recently." Deliberately counts
// anyone who bought, not just first-time buyers — a repeat backer adding
// to their position is still real recent activity.
export async function getRecentBackerCount(artistId: number, hours: number): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare("SELECT COUNT(DISTINCT user_id) AS c FROM next_transactions WHERE artist_id = ? AND type = 'buy' AND created_at >= ?")
    .get(artistId, cutoff) as { c: number };
  return row.c;
}

export type RecentTrade = {
  user_name: string;
  type: NextTransactionType;
  shares: number;
  credits_delta_cents: number;
  created_at: string;
};

// The Trading panel's "recent activity" feed — every trader's activity on
// this one artist, most recent first. Public by the same convention the
// Leaderboard already uses (a trader's chosen display name and portfolio
// figures are visible there too) — nothing here is more sensitive than
// that.
export async function getRecentTradesForArtist(artistId: number, limit = 8): Promise<RecentTrade[]> {
  return await db
    .prepare(`
      SELECT users.name AS user_name, next_transactions.type, next_transactions.shares,
             next_transactions.credits_delta_cents, next_transactions.created_at
      FROM next_transactions
      JOIN users ON users.id = next_transactions.user_id
      WHERE next_transactions.artist_id = ?
      ORDER BY next_transactions.created_at DESC, next_transactions.id DESC
      LIMIT ?
    `)
    .all(artistId, limit) as RecentTrade[];
}

export type MarketTrade = RecentTrade & { artist_id: number; artist_name: string };

// The market-wide version of getRecentTradesForArtist — every trader's
// activity across every artist, most recent first. Powers the Market
// Activity feed; same public-by-precedent convention as the per-artist
// feed above.
export async function getRecentMarketTrades(limit = 30): Promise<MarketTrade[]> {
  return await db
    .prepare(`
      SELECT users.name AS user_name, artists.id AS artist_id, artists.name AS artist_name,
             next_transactions.type, next_transactions.shares, next_transactions.credits_delta_cents,
             next_transactions.created_at
      FROM next_transactions
      JOIN users ON users.id = next_transactions.user_id
      JOIN artists ON artists.id = next_transactions.artist_id
      ORDER BY next_transactions.created_at DESC, next_transactions.id DESC
      LIMIT ?
    `)
    .all(limit) as MarketTrade[];
}

// "Market-wide total virtual volume" — same shape as
// getArtistTradeVolumeCents, just without the per-artist filter.
export async function getMarketVolumeCents(hours: number): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare('SELECT COALESCE(SUM(ABS(credits_delta_cents)), 0) AS volume FROM next_transactions WHERE created_at >= ?')
    .get(cutoff) as { volume: number };
  return row.volume;
}

// "Recent buys" / "Recent sells" counts for the daily recap module.
export async function getMarketTradeCounts(hours: number): Promise<{ buys: number; sells: number }> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare("SELECT type, COUNT(*) AS c FROM next_transactions WHERE created_at >= ? GROUP BY type")
    .all(cutoff) as { type: NextTransactionType; c: number }[];
  const counts = { buys: 0, sells: 0 };
  for (const r of rows) counts[r.type === 'buy' ? 'buys' : 'sells'] = r.c;
  return counts;
}

export type ActiveArtist = { artist_id: number; artist_name: string; tradeCount: number };

// "Most active artists" — ranked by trade count within the window, one
// query for the whole roster (same pattern as getWatchCountsByArtist /
// getBackerCountsByArtist above).
export async function getMostActiveArtists(hours: number, limit = 5): Promise<ActiveArtist[]> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return await db
    .prepare(`
      SELECT artists.id AS artist_id, artists.name AS artist_name, COUNT(*) AS "tradeCount"
      FROM next_transactions
      JOIN artists ON artists.id = next_transactions.artist_id
      WHERE next_transactions.created_at >= ?
      GROUP BY artists.id
      ORDER BY "tradeCount" DESC
      LIMIT ?
    `)
    .all(cutoff, limit) as ActiveArtist[];
}

// "Most backed today" — distinct buyers per artist within the window, for
// the whole roster in one query. The time-windowed sibling of
// getBackerCountsByArtist above (which is all-time and shares-based, not
// "recent activity" based).
export async function getRecentBackerCountsByArtist(hours: number): Promise<Record<number, number>> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare("SELECT artist_id, COUNT(DISTINCT user_id) AS c FROM next_transactions WHERE type = 'buy' AND created_at >= ? GROUP BY artist_id")
    .all(cutoff) as { artist_id: number; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.artist_id, r.c]));
}

// "Most watched today" — the time-windowed sibling of getWatchCountsByArtist.
export async function getRecentWatchCountsByArtist(hours: number): Promise<Record<number, number>> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare('SELECT artist_id, COUNT(*) AS c FROM next_watchlist WHERE created_at >= ? GROUP BY artist_id')
    .all(cutoff) as { artist_id: number; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.artist_id, r.c]));
}

// "Most discussed" — distinct User Takes per artist within the window,
// same shape as getRecentBackerCountsByArtist/getRecentWatchCountsByArtist
// above. First-party (NEXT's own activity), not an external chatter/mention
// count — see lib/feed-signals.ts's Most Discussed signal.
export async function getRecentUserTakeCountsByArtist(hours: number): Promise<Record<number, number>> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare('SELECT artist_id, COUNT(*) AS c FROM feed_user_posts WHERE created_at >= ? GROUP BY artist_id')
    .all(cutoff) as { artist_id: number; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.artist_id, r.c]));
}

// "New artists this week" — live NEXT artists (not passed) added recently,
// most recent first.
export async function getNewArtistsThisWeek(days = 7): Promise<Artist[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return (await getAllArtists())
    .filter((a) => a.stage !== 'passed' && a.created_at >= cutoff)
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
}

export type TradeResult =
  | { ok: true; shares: number; priceCents: number; newBalanceCents: number; realizedPnlCents?: number }
  | { ok: false; error: string };

// Thrown inside the trade transaction to roll it back when the debit's own
// balance guard doesn't match — see the comment at the debit below.
class InsufficientBalanceError extends Error {}

// Both buy and sell take a NEXT Credits amount ("spend $X" / "sell $X
// worth") rather than a share count — simpler for a paper-trading UI, and
// symmetric in both directions. Average-cost method for P&L: cost_basis
// tracks total credits paid for the current position, so unrealized P&L is
// always (current value - cost_basis), and a partial sell reduces cost_basis
// proportionally to the shares sold.
//
// Concurrency: a trade reads a balance, a holding and a price, then writes
// all three. With many requests in flight at once (several app instances,
// or just several awaits interleaving in one), two trades reading the same
// starting state would each write as if the other never happened — a double
// spend, or one price move silently overwriting another. So the whole trade
// runs in ONE transaction that first takes row locks on the trader and then
// on the artist (`FOR UPDATE`): a second trade by the same user, or on the
// same artist, waits at that line until the first has committed, and then
// reads the state the first one left behind. Always user first, then
// artist — one fixed order, so two trades can never each hold the lock the
// other is waiting for.
export async function executeTrade(
  userId: number,
  artistId: number,
  type: NextTransactionType,
  creditsAmountCents: number
): Promise<TradeResult> {
  if (!Number.isFinite(creditsAmountCents) || creditsAmountCents <= 0) {
    return { ok: false, error: 'amount must be a positive number' };
  }
  // Credits are whole cents everywhere they're stored.
  const amountCents = Math.round(creditsAmountCents);
  if (amountCents < 1) return { ok: false, error: 'amount must be a positive number' };

  try {
    return await db.transaction(async (): Promise<TradeResult> => {
      const userRow = (await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? FOR UPDATE`).get(userId)) as User | undefined;
      const artist = (await db.prepare(`${ARTIST_SELECT} WHERE artists.id = ? FOR UPDATE OF artists`).get(artistId)) as Artist | undefined;
      if (!artist) return { ok: false, error: 'artist not found' };
      if (!userRow) return { ok: false, error: 'user not found' };
      const user = normalizeUser(userRow);

      const prePriceCents = await ensureNextPrice(artist);
      const holding = await getHolding(userId, artistId);
      const now = new Date().toISOString();

      if (type === 'buy') {
        // A 'passed' artist is off the public market (see getNextMarket).
        // Anyone still holding it can always sell out; nobody can buy in.
        if (artist.stage === 'passed') return { ok: false, error: 'this artist is no longer listed on NEXT' };
        if (amountCents > user.next_credits_cents) {
          return { ok: false, error: 'not enough NEXT Credits' };
        }
        // Impact is sized by the requested spend, same as the visible market
        // move; the trader's own fill price is the average of pre/post so that
        // impact isn't free money on an immediate resale (see executionPriceCents).
        const postPriceCents = applyTradeImpact(prePriceCents, amountCents, 'buy');
        const executionCents = executionPriceCents(prePriceCents, postPriceCents);
        const shares = amountCents / executionCents;
        const newShares = (holding?.shares ?? 0) + shares;
        const newCostBasis = (holding?.cost_basis_cents ?? 0) + amountCents;
        // Whatever the listen history says right up to this moment — "did this
        // trader ever hit play on this artist before backing them."
        const listenedBeforeBuy = (await hasListenedToArtist(userId, artistId)) ? 1 : 0;

        if (holding) {
          await db.prepare('UPDATE next_holdings SET shares = ?, cost_basis_cents = ?, updated_at = ? WHERE id = ?')
            .run(newShares, newCostBasis, now, holding.id);
        } else {
          await db.prepare('INSERT INTO next_holdings (user_id, artist_id, shares, cost_basis_cents, updated_at) VALUES (?, ?, ?, ?, ?)')
            .run(userId, artistId, newShares, newCostBasis, now);
        }
        // The balance was already checked above under the row lock, so this
        // can't fail today. The debit still carries its own guard
        // (`AND next_credits_cents >= ?`) so that "a balance never goes
        // negative" is enforced by the statement that moves the money, not
        // only by the code path that happens to lead up to it.
        const debit = await db
          .prepare('UPDATE users SET next_credits_cents = next_credits_cents - ? WHERE id = ? AND next_credits_cents >= ?')
          .run(amountCents, userId, amountCents);
        if (debit.changes === 0) throw new InsufficientBalanceError();

        await db.prepare(`
          INSERT INTO next_transactions (user_id, artist_id, created_at, type, shares, price_cents_per_share, credits_delta_cents, listened_before_buy)
          VALUES (?, ?, ?, 'buy', ?, ?, ?, ?)
        `).run(userId, artistId, now, shares, executionCents, -amountCents, listenedBeforeBuy);

        await db.prepare('UPDATE artists SET next_current_price_cents = ? WHERE id = ?').run(postPriceCents, artistId);
        await db.prepare('INSERT INTO next_price_history (artist_id, recorded_at, price_cents) VALUES (?, ?, ?)').run(artistId, now, postPriceCents);

        await recordFoundingBelieverIfFirstBuy(userId, artistId, artist, breakoutScore(artist), executionCents, now);

        return { ok: true, shares, priceCents: executionCents, newBalanceCents: user.next_credits_cents - amountCents };
      }

      // sell
      const ownedShares = holding?.shares ?? 0;
      if (!holding || ownedShares <= 0) return { ok: false, error: "you don't own any shares of this artist" };

      const requestedShares = amountCents / prePriceCents;
      // Size impact by what's actually being sold, not the originally requested
      // amount — matters when the request gets capped by ownedShares. quoteSell
      // is the same math used to mark a still-held position's realistic exit
      // value (see its own comment) — one formula, so the two can never drift.
      const sharesSold = Math.min(requestedShares, ownedShares);
      const { postPriceCents, executionCents, proceedsCents } = quoteSell(prePriceCents, sharesSold);
      const avgCostPerShareCents = holding.cost_basis_cents / ownedShares;
      const costBasisSold = avgCostPerShareCents * sharesSold;
      const realizedPnlCents = Math.round(proceedsCents - costBasisSold);
      const remainingShares = ownedShares - sharesSold;
      const remainingCostBasis = Math.round(holding.cost_basis_cents - costBasisSold);

      if (remainingShares < 0.0001) {
        await db.prepare('DELETE FROM next_holdings WHERE id = ?').run(holding.id);
      } else {
        await db.prepare('UPDATE next_holdings SET shares = ?, cost_basis_cents = ?, updated_at = ? WHERE id = ?')
          .run(remainingShares, remainingCostBasis, now, holding.id);
      }
      await db.prepare('UPDATE users SET next_credits_cents = next_credits_cents + ? WHERE id = ?')
        .run(proceedsCents, userId);
      await db.prepare(`
        INSERT INTO next_transactions (user_id, artist_id, created_at, type, shares, price_cents_per_share, credits_delta_cents, realized_pnl_cents)
        VALUES (?, ?, ?, 'sell', ?, ?, ?, ?)
      `).run(userId, artistId, now, sharesSold, executionCents, proceedsCents, realizedPnlCents);

      await db.prepare('UPDATE artists SET next_current_price_cents = ? WHERE id = ?').run(postPriceCents, artistId);
      await db.prepare('INSERT INTO next_price_history (artist_id, recorded_at, price_cents) VALUES (?, ?, ?)').run(artistId, now, postPriceCents);

      return {
        ok: true,
        shares: sharesSold,
        priceCents: executionCents,
        newBalanceCents: user.next_credits_cents + proceedsCents,
        realizedPnlCents,
      };
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) return { ok: false, error: 'not enough NEXT Credits' };
    throw err;
  }
}

// Anti-spam on trading itself — a generous cap, not a serious abuse
// defense (see lib/market-integrity.ts for the behavioral pattern
// detection that actually targets manipulation). This just stops one
// account from hammering the endpoint faster than any real person trades.
export const TRADE_RATE_LIMIT_PER_MINUTE = 20;

export async function getRecentTradeCount(userId: number, minutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const row = (await db
    .prepare('SELECT COUNT(*) AS c FROM next_transactions WHERE user_id = ? AND created_at >= ?')
    .get(userId, cutoff)) as { c: number };
  return row.c;
}

// Trade idempotency — see trade_idempotency_keys' own comment in the DDL
// above. The route checks getStoredTradeResponse BEFORE calling
// executeTrade at all; a hit means this exact client-generated key was
// already processed, so the route replays the stored response instead of
// trading a second time. storeTradeResponse is called after either a
// successful or a rejected trade — a rejection (e.g. "not enough NEXT
// Credits") is just as worth deduplicating as a success, so a retried
// request doesn't re-run the (cheap but real) validation work either.
export async function getStoredTradeResponse(userId: number, idempotencyKey: string): Promise<{ status: number; body: unknown } | undefined> {
  const row = await db
    .prepare('SELECT status, response_json FROM trade_idempotency_keys WHERE user_id = ? AND idempotency_key = ?')
    .get(userId, idempotencyKey) as { status: number; response_json: string } | undefined;
  return row ? { status: row.status, body: JSON.parse(row.response_json) } : undefined;
}

export async function storeTradeResponse(userId: number, idempotencyKey: string, status: number, body: unknown): Promise<void> {
  // ON CONFLICT DO NOTHING: the first response stored under a key is the
  // one that stays; a second write for the same (user, key) is a no-op.
  await db
    .prepare('INSERT INTO trade_idempotency_keys (user_id, idempotency_key, status, response_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .run(userId, idempotencyKey, status, JSON.stringify(body), new Date().toISOString());
}

export type TradeRequestOutcome = {
  status: number;
  body: unknown;
  // True when this was a repeat of an already-handled request and `body` is
  // the ORIGINAL response — nothing was executed this time.
  replayed: boolean;
  result?: TradeResult;
};

// The whole trade request — duplicate check, rate limit, the trade itself,
// and remembering the response — as one atomic step per user. This is what
// the trade route calls.
//
// Why one transaction: checked separately, two copies of the same request
// arriving together (a double-click, a retry racing the original) would
// both find no stored response and both execute. Taking the user's row lock
// first means the second copy waits here until the first has committed —
// trade, stored response and all — and then finds that stored response and
// replays it instead of trading again. The same lock makes the rate limit
// exact: no burst of parallel requests can all slip under it together.
export async function executeTradeRequest(
  userId: number,
  artistId: number,
  type: NextTransactionType,
  creditsAmountCents: number,
  idempotencyKey?: string
): Promise<TradeRequestOutcome> {
  return await db.transaction(async (): Promise<TradeRequestOutcome> => {
    const locked = await db.prepare('SELECT id FROM users WHERE id = ? FOR UPDATE').get(userId);
    if (!locked) return { status: 401, body: { error: 'unauthorized' }, replayed: false };

    if (idempotencyKey) {
      const stored = await getStoredTradeResponse(userId, idempotencyKey);
      if (stored) return { ...stored, replayed: true };
    }

    // Not stored under the idempotency key — a 429 isn't "the result of
    // this trade attempt," it's "try again shortly."
    if ((await getRecentTradeCount(userId, 1)) >= TRADE_RATE_LIMIT_PER_MINUTE) {
      return { status: 429, body: { error: "You're trading faster than we can keep up — wait a moment and try again." }, replayed: false };
    }

    const result = await executeTrade(userId, artistId, type, creditsAmountCents);
    const status = result.ok ? 200 : 400;
    const body = result.ok ? result : { error: result.error };
    // A rejection (e.g. "not enough NEXT Credits") is stored too, so a
    // retried request gets the same answer rather than a second attempt.
    if (idempotencyKey) await storeTradeResponse(userId, idempotencyKey, status, body);
    return { status, body, replayed: false, result };
  });
}

// Suspicious-trading review — see lib/market-integrity.ts's own header
// comment for what these flags do and don't mean. Pulls the whole trade
// history (small at this app's current scale) and enriches the pure
// detectors' raw ids with names for the admin page to render.
export async function getSuspiciousTradingFlags(): Promise<SuspiciousTradingFlag[]> {
  const transactions = (await db
    .prepare('SELECT user_id, artist_id, created_at FROM next_transactions ORDER BY created_at ASC, id ASC')
    .all()) as MarketTradeRow[];

  const flags = [...getRapidTradingFlags(transactions), ...getCoordinatedPairFlags(transactions)];
  if (flags.length === 0) return flags;

  const userIds = [...new Set(flags.flatMap((f) => f.userIds))];
  const artistIds = [...new Set(flags.map((f) => f.artistId).filter((id): id is number => id != null))];
  const usersById = await getUsersByIds(userIds);
  const artistNamesById = new Map<number, string>();
  if (artistIds.length > 0) {
    const rows = (await db
      .prepare(`SELECT id, name FROM artists WHERE id IN (${artistIds.map(() => '?').join(',')})`)
      .all(...artistIds)) as { id: number; name: string }[];
    for (const row of rows) artistNamesById.set(row.id, row.name);
  }

  return flags.map((f) => ({
    ...f,
    userNames: f.userIds.map((id) => usersById.get(id)?.name ?? `User #${id}`),
    artistName: f.artistId != null ? artistNamesById.get(f.artistId) ?? `Artist #${f.artistId}` : undefined,
  }));
}

// --- Scout Identity: public profiles, leaderboards, Founding Believer ---

export async function getPortfolioValue(userId: number): Promise<PortfolioValue> {
  const user = (await getUserById(userId))!;
  const holdings = await getUserHoldings(userId);
  // exitValueCents, not shares * price_cents — see its own comment on
  // getUserHoldings. Portfolio value should reflect what's actually
  // realizable, not a quote inflated by the holder's own last buy.
  const holdingsValueCents = holdings.reduce((sum, h) => sum + h.exitValueCents, 0);
  const totalValueCents = user.next_credits_cents + holdingsValueCents;
  const totalReturnCents = totalValueCents - NEXT_STARTING_CREDITS_CENTS;
  const totalReturnPct = Math.round((totalReturnCents / NEXT_STARTING_CREDITS_CENTS) * 1000) / 10;
  return { cashCents: user.next_credits_cents, holdingsValueCents, totalValueCents, totalReturnCents, totalReturnPct };
}

export type PortfolioValuePoint = { recorded_at: string; value_cents: number };

type HistoryTransaction = { artist_id: number; created_at: string; type: NextTransactionType; shares: number; credits_delta_cents: number };
type HistoryPricePoint = { artist_id: number; recorded_at: string; price_cents: number };

// Reconstructs total portfolio value (cash + holdings) at every moment
// something relevant happened — one of this user's own trades (which move
// cash and share counts), or ANY trade on an artist they've ever held
// (which moves that artist's next_price_history, same as every other
// trader's fill does for everyone watching that artist's price chart).
// That second part matters: a position's value should move with the
// market even between the user's own trades, not just when they act.
// Grouped by exact timestamp (not walked event-by-event with a cross-table
// tiebreak) because a trade's own transaction row and its own price_history
// row share the identical `now` used inside executeTrade's single
// transaction — applying both before snapshotting is correct regardless of
// which literal row is processed first.
//
// Pure: `transactions` is one user's trades oldest-first; `pricePoints` is
// the price history of every artist they've traded, oldest-first per artist.
function buildPortfolioValueHistory(transactions: HistoryTransaction[], pricePoints: HistoryPricePoint[]): PortfolioValuePoint[] {
  if (transactions.length === 0) return [];

  const moments = new Map<string, { txs: HistoryTransaction[]; prices: HistoryPricePoint[] }>();
  const momentAt = (at: string) => moments.get(at) ?? (moments.set(at, { txs: [], prices: [] }), moments.get(at)!);
  for (const t of transactions) momentAt(t.created_at).txs.push(t);
  for (const p of pricePoints) momentAt(p.recorded_at).prices.push(p);

  let cashCents = NEXT_STARTING_CREDITS_CENTS;
  const sharesByArtist = new Map<number, number>();
  const latestPriceByArtist = new Map<number, number>();

  return [...moments.keys()].sort().map((at) => {
    const m = moments.get(at)!;
    for (const t of m.txs) {
      cashCents += t.credits_delta_cents;
      const delta = t.type === 'buy' ? t.shares : -t.shares;
      sharesByArtist.set(t.artist_id, (sharesByArtist.get(t.artist_id) ?? 0) + delta);
    }
    for (const p of m.prices) latestPriceByArtist.set(p.artist_id, p.price_cents);

    let holdingsValueCents = 0;
    for (const [artistId, shares] of sharesByArtist) holdingsValueCents += shares * (latestPriceByArtist.get(artistId) ?? 0);
    return { recorded_at: at, value_cents: Math.round(cashCents + holdingsValueCents) };
  });
}

export async function getPortfolioValueHistory(userId: number): Promise<PortfolioValuePoint[]> {
  const transactions = (await db
    .prepare('SELECT artist_id, created_at, type, shares, credits_delta_cents FROM next_transactions WHERE user_id = ? ORDER BY created_at ASC, id ASC')
    .all(userId)) as HistoryTransaction[];
  if (transactions.length === 0) return [];

  const artistIds = [...new Set(transactions.map((t) => t.artist_id))];
  const placeholders = artistIds.map(() => '?').join(', ');
  const pricePoints = (await db
    .prepare(`SELECT artist_id, recorded_at, price_cents FROM next_price_history WHERE artist_id IN (${placeholders}) ORDER BY recorded_at ASC, id ASC`)
    .all(...artistIds)) as HistoryPricePoint[];

  return buildPortfolioValueHistory(transactions, pricePoints);
}

// Distinct artists ever backed — reads from next_founding_believers (never
// updated/deleted after insert), so selling a position afterward doesn't
// make it disappear from "artists backed."
export async function getArtistsBackedCount(userId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(DISTINCT artist_id) AS c FROM next_founding_believers WHERE user_id = ?')
    .get(userId) as { c: number };
  return row.c;
}

export async function getEarlyDiscoveriesCount(userId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM next_founding_believers WHERE user_id = ? AND discovery_rank <= ?')
    .get(userId, EARLY_DISCOVERY_RANK_THRESHOLD) as { c: number };
  return row.c;
}

// Phase 7 — crowdsourced-discovery credit, entirely separate from
// getEarlyDiscoveriesCount above (that's about early BUYING; this is about
// FINDING an artist before it was ever on the roster at all, via
// app/next/submit-artist). "Approved" is the Scout's own judgment call
// that the find was real — the same bar a Scout's own YouTube/Soundcharts
// candidates clear before becoming a roster artist.
export async function getApprovedDiscoveriesCount(userId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM discovery_candidates WHERE submitted_by_user_id = ? AND status = 'approved'")
    .get(userId) as { c: number };
  return row.c;
}

// A discovery that went on to become a genuine hit — 'flagship' is this
// app's most deliberate, durable "this artist made it" signal (a Scout's
// considered promotion, not a number that drifts with every rating tweak
// the way NEXT Score does), so it's the bar used here rather than a score
// threshold.
export async function getBreakoutDiscoveriesCount(userId: number): Promise<number> {
  const row = await db
    .prepare(`
      SELECT COUNT(*) AS c FROM discovery_candidates
      JOIN artists ON artists.id = discovery_candidates.artist_id
      WHERE discovery_candidates.submitted_by_user_id = ? AND discovery_candidates.status = 'approved' AND artists.stage = 'flagship'
    `)
    .get(userId) as { c: number };
  return row.c;
}

// The Discoveries "trophy case" list for a Scout profile — every submission
// this user has ever made, whatever its current status. artistName falls
// back to the name they originally typed for a candidate that was never
// approved (nothing to join against in artists).
export async function getDiscoveriesForUser(userId: number): Promise<ScoutDiscoveryEntry[]> {
  const rows = await db
    .prepare(`
      SELECT discovery_candidates.id AS "candidateId", discovery_candidates.artist_id AS "artistId",
             discovery_candidates.name AS "submittedName", artists.name AS "resolvedArtistName",
             artists.stage AS "artistStage", discovery_candidates.status AS status,
             discovery_candidates.discovered_at AS "discoveredAt"
      FROM discovery_candidates
      LEFT JOIN artists ON artists.id = discovery_candidates.artist_id
      WHERE discovery_candidates.submitted_by_user_id = ?
      ORDER BY discovery_candidates.discovered_at DESC
    `)
    .all(userId) as {
      candidateId: number; artistId: number | null; submittedName: string; resolvedArtistName: string | null;
      artistStage: Stage | null; status: DiscoveryCandidateStatus; discoveredAt: string;
    }[];

  return rows.map((r) => ({
    candidateId: r.candidateId,
    artistId: r.artistId ?? undefined,
    artistName: r.resolvedArtistName ?? r.submittedName,
    status: r.status,
    discoveredAt: r.discoveredAt,
    breakout: r.artistStage === 'flagship',
  }));
}

// Same "which genres is this Scout actually good in" idea as
// getFavoriteGenres, but earned through successful discoveries instead of
// backing — an approved find in a genre is real, demonstrated expertise,
// not just a preference.
export async function getDiscoveryGenres(userId: number, limit = 3): Promise<FavoriteGenre[]> {
  return await db
    .prepare(`
      SELECT artists.genre AS genre, COUNT(*) AS count
      FROM discovery_candidates
      JOIN artists ON artists.id = discovery_candidates.artist_id
      WHERE discovery_candidates.submitted_by_user_id = ? AND discovery_candidates.status = 'approved'
        AND artists.genre IS NOT NULL AND artists.genre != ''
      GROUP BY artists.genre
      ORDER BY count DESC, artists.genre ASC
      LIMIT ?
    `)
    .all(userId, limit) as FavoriteGenre[];
}

// Approved (and, of those, breakout) public-submission discoveries for
// every user who has any, in one grouped query. Same definitions as
// getApprovedDiscoveriesCount/getBreakoutDiscoveriesCount above.
async function getDiscoveryCountsByUser(): Promise<Map<number, { approved: number; breakout: number }>> {
  const rows = (await db
    .prepare(`
      SELECT discovery_candidates.submitted_by_user_id AS user_id,
             COUNT(*) AS approved,
             COUNT(*) FILTER (WHERE artists.stage = 'flagship') AS breakout
      FROM discovery_candidates
      LEFT JOIN artists ON artists.id = discovery_candidates.artist_id
      WHERE discovery_candidates.submitted_by_user_id IS NOT NULL AND discovery_candidates.status = 'approved'
      GROUP BY discovery_candidates.submitted_by_user_id
    `)
    .all()) as { user_id: number; approved: number; breakout: number }[];
  return new Map(rows.map((r) => [r.user_id, { approved: r.approved, breakout: r.breakout }]));
}

// The "Top Discoverers" board — ranked by crowdsourced-discovery credit,
// completely independent of getScoutLeaderboard's trading-performance
// ranking. Zero-discovery accounts are left in (unlike getScoutLeaderboard,
// which filters those out at the PAGE level) — app/next/leaderboard.tsx
// applies the same filter here for consistency with how it treats Top
// Scouts, keeping the filtering decision in one place.
export async function getDiscoveryLeaderboard(): Promise<DiscoveryLeaderboardEntry[]> {
  const counts = await getDiscoveryCountsByUser();
  const entries = (await getAllUsers()).map((user) => ({
    user: { id: user.id, name: user.name, avatar_url: user.avatar_url },
    rank: 0,
    approvedDiscoveriesCount: counts.get(user.id)?.approved ?? 0,
    breakoutDiscoveriesCount: counts.get(user.id)?.breakout ?? 0,
  }));
  entries.sort((a, b) => b.approvedDiscoveriesCount - a.approvedDiscoveriesCount || b.breakoutDiscoveriesCount - a.breakoutDiscoveriesCount);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

// "Define which submission gets discovery credit" / "prevent
// duplicate-credit disputes" — the simplest resolution that avoids the
// dispute ever happening: block a second submission of the same artist
// outright rather than creating a rival candidate a Scout would have to
// adjudicate later. A 'passed' candidate does NOT block resubmission —
// Scout already closed that one out; a new submission is a fresh case, not
// a credit dispute over an old one.
export async function findDuplicateArtistSubmission(name: string): Promise<{ kind: 'artist' | 'candidate'; name: string } | undefined> {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return undefined;

  const artist = await db.prepare('SELECT name FROM artists WHERE LOWER(name) = ?').get(normalized) as { name: string } | undefined;
  if (artist) return { kind: 'artist', name: artist.name };

  const candidate = await db
    .prepare("SELECT name FROM discovery_candidates WHERE LOWER(name) = ? AND status != 'passed' ORDER BY discovered_at ASC LIMIT 1")
    .get(normalized) as { name: string } | undefined;
  if (candidate) return { kind: 'candidate', name: candidate.name };

  return undefined;
}

// Anti-spam — a generous cap, not a serious abuse defense (coordinated/
// adversarial abuse is Phase 8 scope, once real prizes/rewards exist to
// abuse). This just stops one person from flooding the Candidate Queue.
export const SUBMISSION_RATE_LIMIT_PER_DAY = 5;

export async function getRecentSubmissionCount(userId: number, hours: number): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM discovery_candidates WHERE submitted_by_user_id = ? AND source = 'public_submission' AND discovered_at >= ?")
    .get(userId, cutoff) as { c: number };
  return row.c;
}

// Everything the leaderboards need to know about one scout.
type ScoutStanding = {
  user: User;
  portfolio: PortfolioValue;
  artistsBackedCount: number;
  earlyDiscoveriesCount: number;
  approvedDiscoveriesCount: number;
  history: PortfolioValuePoint[];
};

// Loads every scout's standing in a fixed handful of queries — holdings,
// founding-believer counts, discovery counts, and the trade/price history
// their past portfolio values are rebuilt from — instead of running that
// same set of queries once per user. A leaderboard is by definition about
// everyone, so its cost shouldn't multiply by the number of accounts.
// Each figure is computed exactly the way its single-user counterpart
// (getPortfolioValue, getArtistsBackedCount, getEarlyDiscoveriesCount,
// getApprovedDiscoveriesCount, getPortfolioValueHistory) computes it.
async function getScoutStandings(): Promise<ScoutStanding[]> {
  const users = await getAllUsers();

  const holdingRows = (await db
    .prepare(`
      SELECT next_holdings.user_id, next_holdings.shares, artists.next_current_price_cents AS price_cents
      FROM next_holdings
      JOIN artists ON artists.id = next_holdings.artist_id
      WHERE next_holdings.shares > 0
    `)
    .all()) as { user_id: number; shares: number; price_cents: number | null }[];
  const holdingsValueByUser = new Map<number, number>();
  for (const h of holdingRows) {
    if (h.price_cents == null) continue; // a held artist always has a price — see getUserHoldings
    holdingsValueByUser.set(h.user_id, (holdingsValueByUser.get(h.user_id) ?? 0) + quoteSell(h.price_cents, h.shares).proceedsCents);
  }

  const believerRows = (await db
    .prepare(`
      SELECT user_id, COUNT(DISTINCT artist_id) AS backed, COUNT(*) FILTER (WHERE discovery_rank <= ?) AS early
      FROM next_founding_believers
      GROUP BY user_id
    `)
    .all(EARLY_DISCOVERY_RANK_THRESHOLD)) as { user_id: number; backed: number; early: number }[];
  const believersByUser = new Map(believerRows.map((r) => [r.user_id, r]));

  const discoveryCounts = await getDiscoveryCountsByUser();

  const txRows = (await db
    .prepare('SELECT user_id, artist_id, created_at, type, shares, credits_delta_cents FROM next_transactions ORDER BY created_at ASC, id ASC')
    .all()) as (HistoryTransaction & { user_id: number })[];
  const txByUser = new Map<number, HistoryTransaction[]>();
  for (const t of txRows) {
    const list = txByUser.get(t.user_id) ?? [];
    list.push(t);
    txByUser.set(t.user_id, list);
  }
  const priceRows = (await db
    .prepare('SELECT artist_id, recorded_at, price_cents FROM next_price_history ORDER BY recorded_at ASC, id ASC')
    .all()) as HistoryPricePoint[];
  const pricesByArtist = new Map<number, HistoryPricePoint[]>();
  for (const p of priceRows) {
    const list = pricesByArtist.get(p.artist_id) ?? [];
    list.push(p);
    pricesByArtist.set(p.artist_id, list);
  }

  return users.map((user) => {
    const holdingsValueCents = holdingsValueByUser.get(user.id) ?? 0;
    const totalValueCents = user.next_credits_cents + holdingsValueCents;
    const totalReturnCents = totalValueCents - NEXT_STARTING_CREDITS_CENTS;
    const totalReturnPct = Math.round((totalReturnCents / NEXT_STARTING_CREDITS_CENTS) * 1000) / 10;

    const transactions = txByUser.get(user.id) ?? [];
    const tradedArtistIds = [...new Set(transactions.map((t) => t.artist_id))];
    const history = buildPortfolioValueHistory(transactions, tradedArtistIds.flatMap((id) => pricesByArtist.get(id) ?? []));

    return {
      user,
      portfolio: { cashCents: user.next_credits_cents, holdingsValueCents, totalValueCents, totalReturnCents, totalReturnPct },
      artistsBackedCount: believersByUser.get(user.id)?.backed ?? 0,
      earlyDiscoveriesCount: believersByUser.get(user.id)?.early ?? 0,
      approvedDiscoveriesCount: discoveryCounts.get(user.id)?.approved ?? 0,
      history,
    };
  });
}

// Total portfolio value as of `cutoffIso` — the last history point at or
// before the cutoff, or NEXT_STARTING_CREDITS_CENTS if the account existed
// by then but hadn't traded yet. Null means the account didn't exist yet at
// the cutoff at all (nothing to compare against, not "started at zero").
function pastPortfolioValueCents(standing: ScoutStanding, cutoffIso: string): number | null {
  if (standing.user.created_at > cutoffIso) return null;
  let value = NEXT_STARTING_CREDITS_CENTS;
  for (const point of standing.history) {
    if (point.recorded_at > cutoffIso) break;
    value = point.value_cents;
  }
  return value;
}

// Current all-time ranking: return % first, ties broken by artists backed.
function rankAllTime(standings: ScoutStanding[]): Omit<LeaderboardEntry, 'rankChange'>[] {
  const entries = standings.map((s) => ({
    user: { id: s.user.id, name: s.user.name, avatar_url: s.user.avatar_url },
    rank: 0,
    totalReturnPct: s.portfolio.totalReturnPct,
    portfolioValueCents: s.portfolio.totalValueCents,
    artistsBackedCount: s.artistsBackedCount,
    earlyDiscoveriesCount: s.earlyDiscoveriesCount,
    approvedDiscoveriesCount: s.approvedDiscoveriesCount,
  }));
  entries.sort((a, b) => b.totalReturnPct - a.totalReturnPct || b.artistsBackedCount - a.artistsBackedCount);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

// How each scout's ALL-TIME rank has moved in the last 7 days. Reuses the
// same portfolio-value reconstruction as the leaderboard itself — no
// separate rank-snapshot table or cron job needed, consistent with how
// Watchlist's alert flags and Portfolio's value chart are also computed
// on demand from existing trade/price history rather than a background job.
function rankMovementsFrom(standings: ScoutStanding[]): Record<number, number | null> {
  const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Past ranking uses raw reconstructed value, not %, but the order is
  // identical to ranking by past return % here: every scout shares the same
  // fixed starting balance, so value and (value - constant) / constant sort
  // the same way.
  const past = standings
    .map((s) => ({ id: s.user.id, value: pastPortfolioValueCents(s, cutoffIso) }))
    .filter((p): p is { id: number; value: number } => p.value != null)
    .sort((a, b) => b.value - a.value);
  const pastRankById = new Map(past.map((p, i) => [p.id, i + 1]));

  const result: Record<number, number | null> = {};
  for (const e of rankAllTime(standings)) {
    const pastRank = pastRankById.get(e.user.id);
    result[e.user.id] = pastRank != null ? pastRank - e.rank : null;
  }
  return result;
}

export async function getRankMovements(): Promise<Record<number, number | null>> {
  return rankMovementsFrom(await getScoutStandings());
}

// getRankMovements() rebuilds every scout's portfolio history, which is
// fine for the Leaderboard page but too much for the notification badge
// that renders on every NEXT page. Standings only change when someone
// trades or an account is created/removed, so the last answer is reused
// until the newest trade id or the number of accounts changes (one cheap
// query to check) — and for at most ten minutes regardless, since "rank a
// week ago" also drifts slowly with the clock.
const RANK_MOVEMENTS_MAX_AGE_MS = 10 * 60 * 1000;
let rankMovementsCache: { key: string; at: number; value: Record<number, number | null> } | null = null;

export async function getRankMovementsCached(): Promise<Record<number, number | null>> {
  const marker = (await db
    .prepare('SELECT (SELECT COALESCE(MAX(id), 0) FROM next_transactions) AS last_trade_id, (SELECT COUNT(*) FROM users) AS user_count')
    .get()) as { last_trade_id: number; user_count: number };
  const key = `${marker.last_trade_id}:${marker.user_count}`;
  if (rankMovementsCache && rankMovementsCache.key === key && Date.now() - rankMovementsCache.at < RANK_MOVEMENTS_MAX_AGE_MS) {
    return rankMovementsCache.value;
  }
  const value = await getRankMovements();
  rankMovementsCache = { key, at: Date.now(), value };
  return value;
}

// Ranked by total return % over `window`; ties broken by artists backed
// (more activity outranks a flat, untouched account at the same %). For
// 'week'/'month', the baseline is each scout's own reconstructed portfolio
// value at the start of that window (or their starting balance, if they
// joined partway through it) — "how much have you grown lately," not just
// all-time. 'all' keeps the original all-time-since-signup baseline
// unchanged (NEXT_STARTING_CREDITS_CENTS for everyone), so existing callers
// that don't pass a window see identical numbers to before.
export async function getScoutLeaderboard(window: LeaderboardWindow = 'all'): Promise<LeaderboardEntry[]> {
  const windowDays = window === 'week' ? 7 : window === 'month' ? 30 : null;
  const cutoffIso = windowDays != null ? new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString() : null;

  const standings = await getScoutStandings();
  const entries = standings.map((s) => {
    const portfolioValueCents = s.portfolio.totalValueCents;
    const baselineCents = cutoffIso != null ? pastPortfolioValueCents(s, cutoffIso) ?? NEXT_STARTING_CREDITS_CENTS : NEXT_STARTING_CREDITS_CENTS;
    const totalReturnPct = baselineCents !== 0 ? Math.round(((portfolioValueCents - baselineCents) / baselineCents) * 1000) / 10 : 0;
    return {
      user: { id: s.user.id, name: s.user.name, avatar_url: s.user.avatar_url },
      rank: 0,
      totalReturnPct,
      portfolioValueCents,
      artistsBackedCount: s.artistsBackedCount,
      earlyDiscoveriesCount: s.earlyDiscoveriesCount,
      approvedDiscoveriesCount: s.approvedDiscoveriesCount,
      rankChange: null as number | null,
    };
  });
  entries.sort((a, b) => b.totalReturnPct - a.totalReturnPct || b.artistsBackedCount - a.artistsBackedCount);
  entries.forEach((e, i) => { e.rank = i + 1; });

  // Rank movement is always relative to all-time standing 7 days ago,
  // independent of `window` — see the LeaderboardEntry.rankChange comment.
  const movements = rankMovementsFrom(standings);
  for (const e of entries) e.rankChange = movements[e.user.id] ?? null;

  return entries;
}

// Ranked by how many artists in that genre this Scout has ever backed —
// reads from next_founding_believers (never erased after a sell), so a
// genre stays "yours" even once you've moved on from every position in it,
// same permanence next_founding_believers already gives the trophy case.
export async function getFavoriteGenres(userId: number, limit = 3): Promise<FavoriteGenre[]> {
  const rows = await db.prepare(`
    SELECT artists.genre AS genre, COUNT(*) AS count
    FROM next_founding_believers
    JOIN artists ON artists.id = next_founding_believers.artist_id
    WHERE next_founding_believers.user_id = ? AND artists.genre IS NOT NULL AND artists.genre != ''
    GROUP BY artists.genre
    ORDER BY count DESC, artists.genre ASC
    LIMIT ?
  `).all(userId, limit) as FavoriteGenre[];
  return rows;
}

export async function getScoutProfile(userId: number): Promise<ScoutProfile | undefined> {
  const user = await getUserById(userId);
  if (!user) return undefined;
  const leaderboard = await getScoutLeaderboard();
  const entry = leaderboard.find((e) => e.user.id === userId)!;
  const portfolio = await getPortfolioValue(userId);
  const earlyDiscoveriesCount = await getEarlyDiscoveriesCount(userId);
  const approvedDiscoveriesCount = await getApprovedDiscoveriesCount(userId);
  const breakoutDiscoveriesCount = await getBreakoutDiscoveriesCount(userId);

  const positions = user.show_positions_publicly
    ? (await getUserHoldings(userId)).map((h) => {
        const marketValueCents = h.exitValueCents; // see getUserHoldings' own comment
        const unrealizedPnlCents = marketValueCents - h.cost_basis_cents;
        const unrealizedPct = h.cost_basis_cents !== 0 ? (unrealizedPnlCents / h.cost_basis_cents) * 100 : 0;
        return {
          artist_id: h.artist_id,
          artist_name: h.artist_name,
          artist_photo_url: h.artist_photo_url,
          shares: h.shares,
          marketValueCents,
          unrealizedPnlCents,
          unrealizedPct,
        };
      })
    : null;

  return {
    user: { id: user.id, name: user.name, avatar_url: user.avatar_url },
    portfolio,
    scoutScoreValue: scoutScore({ totalReturnPct: portfolio.totalReturnPct, earlyDiscoveriesCount, approvedDiscoveriesCount, breakoutDiscoveriesCount }),
    rank: entry.rank,
    totalScouts: leaderboard.length,
    artistsBackedCount: entry.artistsBackedCount,
    earlyDiscoveriesCount,
    favoriteGenres: await getFavoriteGenres(userId),
    showPositionsPublicly: user.show_positions_publicly,
    positions,
    approvedDiscoveriesCount,
    breakoutDiscoveriesCount,
    discoveryGenres: await getDiscoveryGenres(userId),
    discoveries: await getDiscoveriesForUser(userId),
    badges: getScoutBadges({ approvedDiscoveriesCount, breakoutDiscoveriesCount, earlyDiscoveriesCount }),
  };
}

export async function getAvailableGenres(): Promise<string[]> {
  const rows = await db
    .prepare("SELECT DISTINCT genre FROM artists WHERE genre IS NOT NULL AND genre != '' ORDER BY genre ASC")
    .all() as { genre: string }[];
  return rows.map((r) => r.genre);
}

// Ranked by realized + unrealized $ P&L earned specifically from that
// genre's artists (not %, since "amount invested in this genre" isn't
// well-defined once a position's fully sold). Only scouts with at least
// one buy or sell in the genre appear. Two queries for the whole board
// (every open position in the genre, every sell in the genre), grouped by
// user in memory.
export async function getGenreLeaderboard(genre: string): Promise<GenreLeaderboardEntry[]> {
  const holdings = (await db.prepare(`
    SELECT next_holdings.user_id, next_holdings.shares, next_holdings.cost_basis_cents, next_holdings.artist_id,
           artists.next_current_price_cents AS price_cents
    FROM next_holdings
    JOIN artists ON artists.id = next_holdings.artist_id
    WHERE next_holdings.shares > 0 AND artists.genre = ?
  `).all(genre)) as { user_id: number; shares: number; cost_basis_cents: number; artist_id: number; price_cents: number | null }[];

  const sells = (await db.prepare(`
    SELECT next_transactions.user_id, next_transactions.realized_pnl_cents, next_transactions.artist_id
    FROM next_transactions
    JOIN artists ON artists.id = next_transactions.artist_id
    WHERE next_transactions.type = 'sell' AND artists.genre = ?
  `).all(genre)) as { user_id: number; realized_pnl_cents: number | null; artist_id: number }[];

  const byUser = new Map<number, { pnlCents: number; artistIds: Set<number> }>();
  const tally = (userId: number) => byUser.get(userId) ?? (byUser.set(userId, { pnlCents: 0, artistIds: new Set() }), byUser.get(userId)!);

  for (const h of holdings) {
    // A held artist always has a price — see getUserHoldings' same fallback.
    const priceCents = h.price_cents ?? (await ensureNextPrice((await getArtist(h.artist_id))!));
    const t = tally(h.user_id);
    // exitValueCents, not shares * price — see getUserHoldings' own comment.
    t.pnlCents += quoteSell(priceCents, h.shares).proceedsCents - h.cost_basis_cents;
    t.artistIds.add(h.artist_id);
  }
  for (const s of sells) {
    const t = tally(s.user_id);
    t.pnlCents += s.realized_pnl_cents ?? 0;
    t.artistIds.add(s.artist_id);
  }

  const entries: GenreLeaderboardEntry[] = [];
  for (const user of await getAllUsers()) {
    const t = byUser.get(user.id);
    if (!t) continue;
    entries.push({ user: { id: user.id, name: user.name, avatar_url: user.avatar_url }, rank: 0, pnlCents: t.pnlCents, artistsBackedCount: t.artistIds.size });
  }

  entries.sort((a, b) => b.pnlCents - a.pnlCents);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

// Batch form of getFoundingBelieverCountForArtist, one query for many artists.
export async function getFoundingBelieverCountsForArtists(artistIds: number[]): Promise<Map<number, number>> {
  const unique = [...new Set(artistIds)];
  if (unique.length === 0) return new Map();
  const rows = (await db
    .prepare(`SELECT artist_id, COUNT(*) AS c FROM next_founding_believers WHERE artist_id IN (${unique.map(() => '?').join(',')}) GROUP BY artist_id`)
    .all(...unique)) as { artist_id: number; c: number }[];
  return new Map(rows.map((r) => [r.artist_id, r.c]));
}

export async function getFoundingBelieverCountForArtist(artistId: number): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM next_founding_believers WHERE artist_id = ?').get(artistId) as { c: number };
  return row.c;
}

export async function getFoundingBelieverRecordsForUser(
  userId: number
): Promise<(FoundingBelieverRecord & { artist_name: string; artist_photo_url?: string })[]> {
  return await db.prepare(`
    SELECT next_founding_believers.*, artists.name AS artist_name, artists.photo_url AS artist_photo_url
    FROM next_founding_believers
    JOIN artists ON artists.id = next_founding_believers.artist_id
    WHERE next_founding_believers.user_id = ?
    ORDER BY next_founding_believers.purchased_at DESC
  `).all(userId) as (FoundingBelieverRecord & { artist_name: string; artist_photo_url?: string })[];
}

// --- Product analytics ---

// One row per occurrence — see the analytics_events table comment for what
// this does and doesn't cover. userId is nullable (a signed-out event isn't
// possible today since every tracked action requires a session, but the
// column allows for one without a migration later).
export async function logEvent(userId: number | null, eventType: AnalyticsEventType, metadata?: Record<string, unknown>): Promise<void> {
  await db.prepare('INSERT INTO analytics_events (user_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, eventType, metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
}

// Many analytics rows of one type for one user, as a single multi-row
// INSERT — one round trip however many rows there are.
async function insertAnalyticsEvents(userId: number, eventType: AnalyticsEventType, metadatas: Record<string, unknown>[]): Promise<void> {
  if (metadatas.length === 0) return;
  const now = new Date().toISOString();
  const values = metadatas.map(() => '(?, ?, ?, ?)').join(', ');
  await db
    .prepare(`INSERT INTO analytics_events (user_id, event_type, metadata, created_at) VALUES ${values}`)
    .run(...metadatas.flatMap((metadata) => [userId, eventType, JSON.stringify(metadata), now]));
}

// Logs the same artist_card_viewed event once per artist currently on
// Discover — see the Discover page for why this counts as "viewed" rather
// than true scroll-based impression tracking (no client-side observer/API
// round trip per card; one batched write per page load instead).
export async function logArtistCardViews(userId: number, artistIds: number[]): Promise<void> {
  await insertAnalyticsEvents(userId, 'artist_card_viewed', artistIds.map((artistId) => ({ artistId })));
}

// Same batched-impression pattern as logArtistCardViews above, for NEXT
// Feed items — "impression" means "was in the ranked results this
// page/page-of-more returned," logged once per feed_events id, not a
// per-card scroll observer or network round trip.
export async function logFeedItemImpressions(userId: number, feedEventIds: number[]): Promise<void> {
  await insertAnalyticsEvents(userId, 'feed_item_impression', feedEventIds.map((feedEventId) => ({ feedEventId })));
}

function parseEventRow(row: { id: number; user_id: number | null; event_type: string; metadata: string | null; created_at: string }): AnalyticsEvent {
  return { ...row, event_type: row.event_type as AnalyticsEventType, metadata: row.metadata ? JSON.parse(row.metadata) : null };
}

// All-time count per event type — the simplest possible read side, enough
// to verify events are actually being recorded. The MVP metrics dashboard
// (funnels, conversion rates, retention) is its own, later checklist item;
// this one is scoped to tracking, not analyzing.
export async function getEventCountsByType(): Promise<Record<AnalyticsEventType, number>> {
  const rows = await db.prepare('SELECT event_type, COUNT(*) AS c FROM analytics_events GROUP BY event_type').all() as { event_type: AnalyticsEventType; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.event_type, r.c])) as Record<AnalyticsEventType, number>;
}

export async function getRecentEventsForUser(userId: number, limit = 50): Promise<AnalyticsEvent[]> {
  return (await db.prepare('SELECT * FROM analytics_events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(userId, limit) as any[]).map(parseEventRow);
}

// Error monitoring (Phase 10) — see error_reports' own DDL comment. Stack
// traces are capped at a generous-but-bounded length so one runaway report
// can't bloat the table; message has no such cap since it's normally short
// and truncating it risks losing the one line that actually explains what
// broke.
const ERROR_STACK_MAX_CHARS = 4000;

export async function insertErrorReport(input: {
  source: 'client' | 'server';
  message: string;
  stack?: string;
  digest?: string;
  path?: string;
  userId?: number;
}): Promise<void> {
  await db.prepare('INSERT INTO error_reports (source, message, stack, digest, path, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    input.source,
    input.message.slice(0, 2000),
    input.stack ? input.stack.slice(0, ERROR_STACK_MAX_CHARS) : null,
    input.digest ?? null,
    input.path ?? null,
    input.userId ?? null,
    new Date().toISOString()
  );
}

export async function getRecentErrorReports(limit = 100): Promise<ErrorReport[]> {
  return await db
    .prepare(`
      SELECT error_reports.*, users.name AS user_name
      FROM error_reports
      LEFT JOIN users ON users.id = error_reports.user_id
      ORDER BY error_reports.created_at DESC, error_reports.id DESC
      LIMIT ?
    `)
    .all(limit) as any[];
}

export async function getErrorReportCount(hours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = await db.prepare('SELECT COUNT(*) AS c FROM error_reports WHERE created_at >= ?').get(cutoff) as { c: number };
  return row.c;
}

// Whole-table reads for the MVP metrics dashboard (lib/analytics.ts) — this
// app's scale makes "fetch everything once, compute funnels/sessions/
// retention in JS" simpler and just as fast as SQL window functions would
// be, and far more readable for the gap-based session grouping several of
// those metrics need.
export async function getAllEvents(): Promise<AnalyticsEvent[]> {
  return (await db.prepare('SELECT * FROM analytics_events WHERE user_id IS NOT NULL ORDER BY created_at ASC, id ASC').all() as any[]).map(parseEventRow);
}

export type PreviewListenEvent = { user_id: number; artist_id: number; event: 'started' | 'completed'; created_at: string };
export async function getAllPreviewListenEvents(): Promise<PreviewListenEvent[]> {
  return await db.prepare('SELECT user_id, artist_id, event, created_at FROM preview_listens ORDER BY created_at ASC, id ASC').all() as PreviewListenEvent[];
}

export type AnalyticsTransaction = { user_id: number; artist_id: number; type: NextTransactionType; created_at: string; listened_before_buy: number | null };
export async function getAllTransactionsForAnalytics(): Promise<AnalyticsTransaction[]> {
  return await db
    .prepare('SELECT user_id, artist_id, type, created_at, listened_before_buy FROM next_transactions ORDER BY created_at ASC, id ASC')
    .all() as AnalyticsTransaction[];
}

// Stamps last_login_at and reports whether this is a RETURNING session —
// true only when the user already had a last_login_at before this call,
// i.e. not their very first login right after signup. The caller decides
// whether to log session_returned from that (see app/api/auth/login).
export async function recordLogin(userId: number): Promise<{ returning: boolean }> {
  const before = await getUserById(userId);
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), userId);
  return { returning: Boolean(before?.last_login_at) };
}

// --- Discovery Engine ---

export async function getTrackedSoundchartsUuids(): Promise<Set<string>> {
  const rows = await db.prepare("SELECT soundcharts_uuid FROM artists WHERE soundcharts_uuid IS NOT NULL").all() as { soundcharts_uuid: string }[];
  return new Set(rows.map((r) => r.soundcharts_uuid));
}

// Every artist linked to a Soundcharts profile — the exact set a sync run
// needs to refresh. Unlinked artists (no soundcharts_uuid) are untouched by
// automated sync; their stats stay manual-entry only, same as today.
export async function getArtistsWithSoundchartsLink(): Promise<{ id: number; name: string; soundcharts_uuid: string }[]> {
  return await db
    .prepare("SELECT id, name, soundcharts_uuid FROM artists WHERE soundcharts_uuid IS NOT NULL")
    .all() as { id: number; name: string; soundcharts_uuid: string }[];
}

// The gap getArtistsWithSoundchartsLink above never covered: an artist that
// never got linked in the first place (a failed on-create lookup — see
// app/api/artists/route.ts and components/BulkAddArtists.tsx — or one added
// before Soundcharts was wired in) sits with no photo forever, since the
// regular sync only re-syncs artists ALREADY linked by uuid. This is the
// search-and-link backfill that's missing that step, mirroring
// getArtistsMissingVideo's "touch everyone still missing it, but respect a
// recent honest no-match" shape.
export const SOUNDCHARTS_NO_MATCH_RECHECK_DAYS = 14;

export async function getArtistsMissingPhoto(): Promise<{ id: number; name: string }[]> {
  const recheckCutoff = new Date(Date.now() - SOUNDCHARTS_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return await db
    .prepare(`
      SELECT id, name FROM artists
      WHERE (photo_url IS NULL OR photo_url = '') AND soundcharts_uuid IS NULL
        AND (soundcharts_no_match_at IS NULL OR soundcharts_no_match_at < ?)
    `)
    .all(recheckCutoff) as { id: number; name: string }[];
}

export async function stampSoundchartsNoMatch(artistId: number, at: string = new Date().toISOString()): Promise<void> {
  await db.prepare('UPDATE artists SET soundcharts_no_match_at = ? WHERE id = ?').run(at, artistId);
}

export type PhotoBackoffStatus = { count: number; earliestRecheckAt?: string };

// Same "why did this say checked 0" visibility as getArtistsInVideoBackoff.
export async function getArtistsInPhotoBackoff(): Promise<PhotoBackoffStatus> {
  const cutoff = new Date(Date.now() - SOUNDCHARTS_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare(`
      SELECT soundcharts_no_match_at FROM artists
      WHERE (photo_url IS NULL OR photo_url = '') AND soundcharts_uuid IS NULL
        AND soundcharts_no_match_at IS NOT NULL AND soundcharts_no_match_at >= ?
      ORDER BY soundcharts_no_match_at ASC
    `)
    .all(cutoff) as { soundcharts_no_match_at: string }[];
  if (rows.length === 0) return { count: 0 };
  const earliestRecheckAt = new Date(new Date(rows[0].soundcharts_no_match_at).getTime() + SOUNDCHARTS_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { count: rows.length, earliestRecheckAt };
}

// --- Wikidata match cache (see lib/wikidata.ts) ---

export async function saveWikidataMatch(artistId: number, qid: string): Promise<void> {
  await db.prepare('UPDATE artists SET wikidata_qid = ?, wikidata_fetched_at = ?, wikidata_no_match_at = NULL WHERE id = ?')
    .run(qid, new Date().toISOString(), artistId);
}

// A genuine no-match is cached same as soundcharts_no_match_at/
// youtube_no_match_at — most artists on this roster are small enough that
// Wikidata has no entry for them at all, which is an expected, valid
// outcome (see lib/wikidata.ts's file header), not something to keep
// re-searching for on every form load.
export async function saveWikidataNoMatch(artistId: number, at: string = new Date().toISOString()): Promise<void> {
  await db.prepare('UPDATE artists SET wikidata_fetched_at = ?, wikidata_no_match_at = ? WHERE id = ?').run(at, at, artistId);
}

// --- Claimed-artist photo upload (pre-beta migration: item 3/33 of the
// migration brief) — the ONE write path for artists.photo_source_type =
// 'ARTIST_PROVIDED'. Deliberately not routed through the generic
// updateArtist()/WRITABLE_FIELDS path (unlike photo_url itself, which a
// Scout can set directly): rightsConfirmed must be an explicit, real
// checkbox click, not a client-suppliable boolean, and uploadedByUserId
// must be the actual acting user's id, not anything the request body could
// spoof — see app/api/next/my-artist/[id]/photo/route.ts, the only caller. ---
export async function setArtistPhotoByOwner(artistId: number, photoUrl: string, uploadedByUserId: number): Promise<Artist | undefined> {
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE artists SET
      updated_at = ?, photo_url = ?, photo_source_type = 'ARTIST_PROVIDED', photo_source_url = ?,
      photo_attribution = NULL, photo_license = NULL, photo_license_url = NULL,
      photo_uploaded_by_user_id = ?, photo_uploaded_at = ?, photo_rights_confirmed_at = ?
    WHERE id = ?
  `).run(now, photoUrl, photoUrl, uploadedByUserId, now, now, artistId);
  return await getArtist(artistId);
}

// Lets an admin (never the claimed artist themself) remove an
// ARTIST_PROVIDED photo — the migration brief's "admin must be able to
// remove an uploaded asset" — falling back to no photo (the resolver's
// gradient/initial fallback takes over) rather than silently reverting to
// whatever photo_url happened to be there before, which could just as
// easily have been another removed/disputed image.
export async function removeArtistProvidedPhoto(artistId: number): Promise<Artist | undefined> {
  const artist = await getArtist(artistId);
  if (!artist || artist.photo_source_type !== 'ARTIST_PROVIDED') return artist;
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE artists SET
      updated_at = ?, photo_url = NULL, photo_source_type = NULL, photo_source_url = NULL,
      photo_attribution = NULL, photo_license = NULL, photo_license_url = NULL,
      photo_uploaded_by_user_id = NULL, photo_uploaded_at = NULL, photo_rights_confirmed_at = NULL
    WHERE id = ?
  `).run(now, artistId);
  return await getArtist(artistId);
}

export async function createSyncRun(source: SyncSourceKey = 'soundcharts'): Promise<SyncRun> {
  const now = new Date().toISOString();
  const info = await db
    .prepare("INSERT INTO sync_runs (started_at, status, checked_count, updated_count, failed_count, source) VALUES (?, 'running', 0, 0, 0, ?)")
    .run(now, source);
  return await db.prepare('SELECT * FROM sync_runs WHERE id = ?').get(info.lastInsertRowid) as SyncRun;
}

export async function completeSyncRun(
  id: number,
  result: {
    status: 'completed' | 'failed'; checkedCount: number; updatedCount: number; failedCount: number; error?: string;
    noMatchCount?: number; errorCount?: number; lastError?: string;
  }
): Promise<void> {
  await db.prepare(`
    UPDATE sync_runs
    SET completed_at = ?, status = ?, checked_count = ?, updated_count = ?, failed_count = ?, error = ?,
        no_match_count = ?, error_count = ?, last_error = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(), result.status, result.checkedCount, result.updatedCount, result.failedCount, result.error ?? null,
    result.noMatchCount ?? null, result.errorCount ?? null, result.lastError ?? null, id
  );
}

export async function getLatestSyncRun(source: SyncSourceKey = 'soundcharts'): Promise<SyncRun | undefined> {
  return await db
    // id DESC breaks ties when two runs share the same started_at timestamp
    // (millisecond-resolution ISO strings collide easily under fast/automated
    // syncs) — started_at alone isn't a reliable "most recent" ordering.
    .prepare('SELECT * FROM sync_runs WHERE source = ? ORDER BY started_at DESC, id DESC LIMIT 1')
    .get(source) as SyncRun | undefined;
}

// A per-artist, per-source "last checked" timestamp — distinct from
// SyncRun, which only records a whole batch run, not which artists it
// actually touched. Called by each sync route (and the on-create lookups in
// app/api/artists/route.ts) whenever a check against that source genuinely
// completed for this artist, success or a clean no-match alike — never on a
// network/API error, where nothing was actually confirmed one way or the
// other. See the Artist type for the exact semantics.
export async function stampSourceSyncedAt(artistId: number, source: 'soundcharts' | 'deezer' | 'youtube', at: string = new Date().toISOString()): Promise<void> {
  const column = source === 'soundcharts' ? 'soundcharts_synced_at' : source === 'deezer' ? 'deezer_synced_at' : 'youtube_synced_at';
  await db.prepare(`UPDATE artists SET ${column} = ? WHERE id = ?`).run(at, artistId);
}

export async function setFeaturedVideoMatchType(artistId: number, matchType: Artist['featured_video_match_type'] | null): Promise<void> {
  await db.prepare('UPDATE artists SET featured_video_match_type = ? WHERE id = ?').run(matchType ?? null, artistId);
}

// Structured, queryable failure history — see the SyncFailure type for why
// this exists alongside SyncRun's aggregate counters. Deliberately only
// ever called for a real error, never a clean no-match.
export async function logSyncFailure(runId: number, source: SyncSourceKey, artistId: number, artistName: string, error: string): Promise<void> {
  await db.prepare('INSERT INTO sync_failures (run_id, source, artist_id, artist_name, error, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(runId, source, artistId, artistName, error, new Date().toISOString());
}

export async function getRecentSyncFailures(source?: SyncSourceKey, limit = 50): Promise<SyncFailure[]> {
  if (source) {
    return await db.prepare('SELECT * FROM sync_failures WHERE source = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(source, limit) as SyncFailure[];
  }
  return await db.prepare('SELECT * FROM sync_failures ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as SyncFailure[];
}

// YouTube quota tracking — `quotaDay` is a caller-computed "YYYY-MM-DD in
// Pacific time" string (see lib/youtube.ts), not computed here, so this
// stays a plain "N units for day X" ledger with no timezone logic of its
// own. Every call through lib/youtube.ts's youtubeFetch records here,
// covering discovery scans, artist backfills, and on-create lookups alike
// — the first true cross-route daily total (discovery_runs.quota_used is
// only ever a single run's own estimate).
export async function recordYoutubeQuotaUsage(units: number, endpoint: string, quotaDay: string): Promise<void> {
  await db.prepare('INSERT INTO youtube_quota_usage (quota_day, units, endpoint, created_at) VALUES (?, ?, ?, ?)')
    .run(quotaDay, units, endpoint, new Date().toISOString());
}

export async function getYoutubeQuotaUsedToday(quotaDay: string): Promise<number> {
  return (await db.prepare('SELECT COALESCE(SUM(units), 0) AS total FROM youtube_quota_usage WHERE quota_day = ?').get(quotaDay) as { total: number }).total;
}

// Artists still missing a top song link OR a photo, for Deezer sync — one
// artist-search call (see lib/deezer.ts's getTopSongForArtist) can fill
// either or both, so one query covers everyone that call is worth making
// for. Unlike Soundcharts sync (which only touches artists explicitly
// linked by uuid, but always re-fetches), this touches every artist
// regardless of a Soundcharts link, but only ones missing at least one of
// the two fields. Once filled — by this sync or typed in by hand — each
// field is a Scout's own curatorial choice, so neither is ever silently
// overwritten; clear a field to have sync fill it again.
export async function getArtistsMissingDeezerData(): Promise<{ id: number; name: string }[]> {
  return await db
    .prepare(`
      SELECT id, name FROM artists
      WHERE (top_song_url IS NULL OR top_song_url = '') OR (photo_url IS NULL OR photo_url = '')
    `)
    .all() as { id: number; name: string }[];
}

// Same "touch everyone, but only fill what's missing" shape as
// getArtistsMissingTopSong — a video a Scout picked by hand (or a
// discovery-approval video) is never silently overwritten; clear the
// field to have sync fill it again.
// How long a genuine "no YouTube video found" result sticks before an
// artist is worth re-checking — avoids burning quota re-searching someone
// with no YouTube presence every single day, while still catching it if a
// video eventually appears (see the youtube_no_match_at column comment).
export const YOUTUBE_NO_MATCH_RECHECK_DAYS = 14;

export async function getArtistsMissingVideo(): Promise<{ id: number; name: string; youtube_url?: string }[]> {
  const recheckCutoff = new Date(Date.now() - YOUTUBE_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return await db
    .prepare(`
      SELECT id, name, youtube_url FROM artists
      WHERE (featured_video_id IS NULL OR featured_video_id = '')
        AND (youtube_no_match_at IS NULL OR youtube_no_match_at < ?)
    `)
    .all(recheckCutoff) as { id: number; name: string; youtube_url?: string }[];
}

export async function stampYoutubeNoMatch(artistId: number, at: string = new Date().toISOString()): Promise<void> {
  await db.prepare('UPDATE artists SET youtube_no_match_at = ? WHERE id = ?').run(at, artistId);
}

export type VideoBackoffStatus = { count: number; earliestRecheckAt?: string };

// The exact inverse of getArtistsMissingVideo's exclusion — artists still
// missing a video that WON'T show up on the next backfill run because
// they were checked too recently. Without this, "checked 0, updated 0" on
// a backfill run looks identical whether the roster genuinely has no
// artists left to check or every candidate is just sitting in this
// backoff window — this makes the difference visible on Admin sync health.
export async function getArtistsInVideoBackoff(): Promise<VideoBackoffStatus> {
  const cutoff = new Date(Date.now() - YOUTUBE_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .prepare(`
      SELECT youtube_no_match_at FROM artists
      WHERE (featured_video_id IS NULL OR featured_video_id = '')
        AND youtube_no_match_at IS NOT NULL AND youtube_no_match_at >= ?
      ORDER BY youtube_no_match_at ASC
    `)
    .all(cutoff) as { youtube_no_match_at: string }[];
  if (rows.length === 0) return { count: 0 };
  const earliestRecheckAt = new Date(new Date(rows[0].youtube_no_match_at).getTime() + YOUTUBE_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { count: rows.length, earliestRecheckAt };
}

// A featured video matched via an unverified top-relevance search hit
// (see lib/youtube.ts's 'search_unverified' match type) — genuinely likely
// to be the wrong video, not just an artist with no video at all. Powers
// the Admin sync-health page's data-reliability summary.
export async function getUnverifiedVideoMatchCount(): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS c FROM artists WHERE featured_video_match_type = 'search_unverified'").get() as { c: number }).c;
}

export type PlatformLinksImpact = {
  artistsMissingAllLinks: number;
  totalArtists: number;
  viewsOnArtistsMissingAllLinks: number;
  totalArtistDetailViews: number;
};

// "Track how often missing platform links materially hurt the product"
// (Phase 4's Soundcharts limitations section) — Soundcharts' artist-
// metadata endpoint doesn't return Spotify/Instagram/TikTok/YouTube links
// on this app's plan (see README), and those stay manual. Rather than a
// static "N artists have no links" count, this ties the gap to real usage:
// how many actual Artist Detail views (already tracked by Phase 3's event
// log — no new instrumentation needed) landed on an artist with NONE of
// the four links at all, the worst case. A tiny number here across real
// traffic is the evidence for "keep working around it"; a large one is
// the evidence for revisiting the Soundcharts plan — see the checklist's
// own "revisit only when real user volume/data needs justify it."
export async function getMissingPlatformLinksImpact(): Promise<PlatformLinksImpact> {
  const artists = await getAllArtists();
  const missingIds = new Set(
    artists.filter((a) => !a.spotify_url && !a.instagram_url && !a.tiktok_url && !a.youtube_url).map((a) => a.id)
  );
  const views = (await getAllEvents()).filter((e) => e.event_type === 'artist_detail_opened');
  const viewsOnArtistsMissingAllLinks = views.filter((e) => {
    const artistId = (e.metadata as any)?.artistId;
    return typeof artistId === 'number' && missingIds.has(artistId);
  }).length;
  return { artistsMissingAllLinks: missingIds.size, totalArtists: artists.length, viewsOnArtistsMissingAllLinks, totalArtistDetailViews: views.length };
}

// Candidates already reviewed (watching/approved/passed) for a name are
// skipped on future scans too — a "no thanks" from a Scout should stick,
// not reappear every day just because the artist is still growing.
export async function getKnownDiscoveryUuids(): Promise<Set<string>> {
  const rows = await db
    .prepare('SELECT soundcharts_uuid FROM discovery_candidates WHERE soundcharts_uuid IS NOT NULL')
    .all() as { soundcharts_uuid: string }[];
  return new Set(rows.map((r) => r.soundcharts_uuid));
}

// Same "a no-thanks sticks" rule, keyed by YouTube channel instead — a
// channel already sitting in the queue (any status) is skipped on future
// YouTube scans, whether or not it ever picked up a Soundcharts match.
export async function getKnownDiscoveryYoutubeChannelIds(): Promise<Set<string>> {
  const rows = await db
    .prepare('SELECT yt_channel_id FROM discovery_candidates WHERE yt_channel_id IS NOT NULL')
    .all() as { yt_channel_id: string }[];
  return new Set(rows.map((r) => r.yt_channel_id));
}

export async function createDiscoveryRun(source: DiscoverySourceKey = 'soundcharts'): Promise<DiscoveryRun> {
  const now = new Date().toISOString();
  const info = await db
    .prepare("INSERT INTO discovery_runs (started_at, status, searched_count, candidates_found, source) VALUES (?, 'running', 0, 0, ?)")
    .run(now, source);
  return await db.prepare('SELECT * FROM discovery_runs WHERE id = ?').get(info.lastInsertRowid) as DiscoveryRun;
}

export async function completeDiscoveryRun(
  id: number,
  result: {
    status: 'completed' | 'failed'; searchedCount: number; candidatesFound: number; error?: string; quotaUsed?: number;
    rejectionBreakdown?: DiscoveryRejectionBreakdown;
  }
): Promise<void> {
  const r = result.rejectionBreakdown;
  // rejected_below_momentum_threshold / best_rejected_momentum_score are
  // legacy columns (see the momentum_score comment in the schema above) —
  // always written null now that no momentum score is computed to reject
  // candidates against; kept so historical pre-migration run rows are
  // untouched.
  await db.prepare(`
    UPDATE discovery_runs
    SET completed_at = ?, status = ?, searched_count = ?, candidates_found = ?, error = ?, quota_used = ?,
        rejected_not_official_release = ?, rejected_below_min_views = ?, rejected_no_subscriber_count = ?,
        rejected_subscriber_out_of_band = ?, rejected_below_momentum_threshold = ?, best_rejected_momentum_score = ?,
        rejected_duplicate_soundcharts_match = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(), result.status, result.searchedCount, result.candidatesFound, result.error ?? null, result.quotaUsed ?? null,
    r?.notOfficialRelease ?? null, r?.belowMinViews ?? null, r?.noSubscriberCount ?? null, r?.subscriberOutOfBand ?? null,
    null, null, r?.duplicateSoundchartsMatch ?? null, id
  );
}

export async function getLatestDiscoveryRun(source: DiscoverySourceKey = 'soundcharts'): Promise<DiscoveryRun | undefined> {
  return await db
    // Same started_at tie-break as getLatestSyncRun above.
    .prepare('SELECT * FROM discovery_runs WHERE source = ? ORDER BY started_at DESC, id DESC LIMIT 1')
    .get(source) as DiscoveryRun | undefined;
}

export type NewDiscoveryCandidate = {
  source: DiscoverySourceKey;
  soundcharts_uuid?: string;
  name: string;
  photo_url?: string;
  country?: string;
  followers_count?: number;
  followers_7d_ago?: number;
  followers_30d_ago?: number;
  growth_7d_pct?: number;
  growth_30d_pct?: number;
  yt_video_id?: string;
  yt_channel_id?: string;
  yt_channel_title?: string;
  yt_genre?: string;
  yt_view_count?: number;
  yt_like_count?: number;
  yt_comment_count?: number;
  yt_published_at?: string;
  yt_channel_subscriber_count?: number;
  yt_channel_view_count?: number;
  yt_views_per_day?: number;
  yt_like_rate?: number;
  yt_comment_rate?: number;
  yt_views_per_subscriber?: number;
  yt_hype_comment_rate?: number;
  yt_comments_analyzed?: number;
  yt_example_comment_1?: string;
  yt_example_comment_1_likes?: number;
  yt_example_comment_2?: string;
  yt_example_comment_2_likes?: number;
  flagged_reason: string;
  // Which scan run found this candidate — see the discovery_run_id column
  // comment. Optional because the (dormant) Soundcharts source predates
  // this and hasn't been wired to pass it; a candidate without it just
  // never shows up attributed to a run on the Admin discovery page.
  discovery_run_id?: number;
  // source='public_submission' only — see DiscoverySourceKey's comment.
  submitted_by_user_id?: number;
  submission_url?: string;
};

const DISCOVERY_CANDIDATE_COLUMNS = [
  'source', 'soundcharts_uuid', 'name', 'photo_url', 'country',
  'followers_count', 'followers_7d_ago', 'followers_30d_ago', 'growth_7d_pct', 'growth_30d_pct',
  'yt_video_id', 'yt_channel_id', 'yt_channel_title', 'yt_genre', 'yt_view_count', 'yt_like_count',
  'yt_comment_count', 'yt_published_at', 'yt_channel_subscriber_count', 'yt_channel_view_count',
  'yt_views_per_day', 'yt_like_rate', 'yt_comment_rate', 'yt_views_per_subscriber', 'yt_hype_comment_rate',
  'yt_comments_analyzed', 'yt_example_comment_1', 'yt_example_comment_1_likes', 'yt_example_comment_2',
  'yt_example_comment_2_likes', 'flagged_reason', 'discovery_run_id',
  'submitted_by_user_id', 'submission_url',
] as const;

// candidate_id isn't known until the INSERT above returns its rowid — a
// second statement, not a trigger, keeps this readable and matches how
// every other history/audit table in this app is written (see
// logSyncFailure). from_status is always null here: this row IS the
// candidate's discovery, not a transition from some prior state.
async function logDiscoveryCandidateDiscovered(candidateId: number): Promise<void> {
  await db.prepare('INSERT INTO discovery_candidate_history (candidate_id, from_status, to_status, actor_id, created_at) VALUES (?, NULL, ?, NULL, ?)')
    .run(candidateId, 'new', new Date().toISOString());
}

export async function insertDiscoveryCandidate(c: NewDiscoveryCandidate): Promise<void> {
  const columns = [...DISCOVERY_CANDIDATE_COLUMNS, 'status', 'discovered_at'];
  const placeholders = DISCOVERY_CANDIDATE_COLUMNS.map((col) => `@${col}`).join(', ');
  const row: Record<string, unknown> = { discovered_at: new Date().toISOString() };
  for (const col of DISCOVERY_CANDIDATE_COLUMNS) row[col] = (c as any)[col] ?? null;
  const info = await db.prepare(`
    INSERT INTO discovery_candidates (${columns.join(', ')})
    VALUES (${placeholders}, 'new', @discovered_at)
  `).run(row);
  await logDiscoveryCandidateDiscovered(info.lastInsertRowid as number);
}

const DISCOVERY_CANDIDATE_SELECT = `
  SELECT discovery_candidates.*, users.name AS reviewed_by_name, submitters.name AS submitted_by_name
  FROM discovery_candidates
  LEFT JOIN users ON users.id = discovery_candidates.reviewed_by
  LEFT JOIN users submitters ON submitters.id = discovery_candidates.submitted_by_user_id
`;

// Soundcharts candidates rank by 30-day growth % (a single real metric, not
// a blended score). YouTube candidates no longer carry any composite score
// (pre-beta migration — see lib/youtube-momentum.ts) so they fall through
// to the discovered_at tiebreak, newest first — a simple, non-derived order,
// not a replacement formula.
export async function getDiscoveryCandidates(status?: DiscoveryCandidateStatus): Promise<DiscoveryCandidate[]> {
  if (status) {
    return await db
      .prepare(`${DISCOVERY_CANDIDATE_SELECT} WHERE discovery_candidates.status = ? ORDER BY discovery_candidates.growth_30d_pct DESC NULLS LAST, discovery_candidates.discovered_at DESC`)
      .all(status) as DiscoveryCandidate[];
  }
  return await db
    .prepare(`${DISCOVERY_CANDIDATE_SELECT} ORDER BY discovery_candidates.discovered_at DESC`)
    .all() as DiscoveryCandidate[];
}

export async function getNewDiscoveryCandidateCount(): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS c FROM discovery_candidates WHERE status = 'new'").get() as { c: number };
  return row.c;
}

export async function getDiscoveryCandidate(id: number): Promise<DiscoveryCandidate | undefined> {
  return await db.prepare(`${DISCOVERY_CANDIDATE_SELECT} WHERE discovery_candidates.id = ?`).get(id) as DiscoveryCandidate | undefined;
}

async function logDiscoveryCandidateHistory(candidateId: number, fromStatus: DiscoveryCandidateStatus, toStatus: DiscoveryCandidateStatus, actorId: number): Promise<void> {
  await db.prepare('INSERT INTO discovery_candidate_history (candidate_id, from_status, to_status, actor_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(candidateId, fromStatus, toStatus, actorId, new Date().toISOString());
}

export async function setDiscoveryCandidateStatus(
  id: number,
  status: 'watching' | 'passed',
  actor: Actor
): Promise<DiscoveryCandidate | undefined> {
  const existing = await getDiscoveryCandidate(id);
  if (!existing) return undefined;
  const info = await db
    .prepare('UPDATE discovery_candidates SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?')
    .run(status, new Date().toISOString(), actor.id, id);
  if (info.changes === 0) return undefined;
  await logDiscoveryCandidateHistory(id, existing.status, status, actor.id);
  return await getDiscoveryCandidate(id);
}

export async function getDiscoveryCandidateHistory(candidateId: number): Promise<DiscoveryCandidateHistoryEntry[]> {
  return await db
    .prepare(`
      SELECT discovery_candidate_history.*, users.name AS actor_name
      FROM discovery_candidate_history
      LEFT JOIN users ON users.id = discovery_candidate_history.actor_id
      WHERE candidate_id = ?
      ORDER BY discovery_candidate_history.created_at ASC, discovery_candidate_history.id ASC
    `)
    .all(candidateId) as DiscoveryCandidateHistoryEntry[];
}

// A cross-candidate audit feed for the Admin discovery page — every real
// review decision (not the initial "discovered" row, which isn't a
// decision anyone made), most recent first.
export async function getRecentDiscoveryReviewDecisions(limit = 30): Promise<(DiscoveryCandidateHistoryEntry & { candidate_name: string; candidate_source: DiscoverySourceKey })[]> {
  return await db
    .prepare(`
      SELECT discovery_candidate_history.*, users.name AS actor_name,
             discovery_candidates.name AS candidate_name, discovery_candidates.source AS candidate_source
      FROM discovery_candidate_history
      JOIN discovery_candidates ON discovery_candidates.id = discovery_candidate_history.candidate_id
      LEFT JOIN users ON users.id = discovery_candidate_history.actor_id
      WHERE discovery_candidate_history.from_status IS NOT NULL
      ORDER BY discovery_candidate_history.created_at DESC, discovery_candidate_history.id DESC
      LIMIT ?
    `)
    .all(limit) as (DiscoveryCandidateHistoryEntry & { candidate_name: string; candidate_source: DiscoverySourceKey })[];
}

export async function getDiscoveryCandidateCountsByStatus(): Promise<Record<DiscoveryCandidateStatus, number>> {
  const rows = await db.prepare('SELECT status, COUNT(*) AS c FROM discovery_candidates GROUP BY status').all() as { status: DiscoveryCandidateStatus; c: number }[];
  const counts: Record<DiscoveryCandidateStatus, number> = { new: 0, watching: 0, approved: 0, passed: 0 };
  for (const row of rows) counts[row.status] = row.c;
  return counts;
}

// Genre coverage monitoring — YouTube-only (yt_genre is null for every
// Soundcharts candidate), so a genre that's gone quiet (0 candidates for
// several runs) is visible instead of invisible inside one aggregate count.
export async function getDiscoveryCandidateCountsByGenre(): Promise<{ genre: string; count: number }[]> {
  return await db
    .prepare("SELECT yt_genre AS genre, COUNT(*) AS count FROM discovery_candidates WHERE yt_genre IS NOT NULL GROUP BY yt_genre ORDER BY count DESC")
    .all() as { genre: string; count: number }[];
}

// "Candidate count by scan" — the run history the Admin discovery page
// actually needs (getLatestDiscoveryRun alone only ever shows one row).
// candidateCount reflects insertDiscoveryCandidate's own bookkeeping via
// discovery_run_id, which can differ from a run's own candidates_found if
// an insert failed after scoring (see app/api/discovery/scan-youtube) —
// showing both side by side surfaces that gap instead of hiding it.
export async function getRecentDiscoveryRunsWithCandidateCounts(source: DiscoverySourceKey, limit = 10): Promise<(DiscoveryRun & { candidateCount: number })[]> {
  return await db
    .prepare(`
      SELECT discovery_runs.*, COUNT(discovery_candidates.id) AS "candidateCount"
      FROM discovery_runs
      LEFT JOIN discovery_candidates ON discovery_candidates.discovery_run_id = discovery_runs.id
      WHERE discovery_runs.source = ?
      GROUP BY discovery_runs.id
      ORDER BY discovery_runs.started_at DESC, discovery_runs.id DESC
      LIMIT ?
    `)
    .all(source, limit) as (DiscoveryRun & { candidateCount: number })[];
}

// Approving a candidate creates the real, editable artist row — pre-filled
// with what Discovery already knows, stage 'watchlist', score inputs at the
// neutral default. It does NOT auto-list on NEXT or assign a Breakout Score;
// a human still rates the eight categories before this artist is real to
// the product, same as any artist Scout added by hand.
// The scan-bucket keys used internally by lib/youtube-discovery.ts
// (DEFAULT_YOUTUBE_GENRES) — a Scout approving a candidate should see
// "Hip-Hop/Rap," not the raw search-bucket key "hip-hop-rap".
export const YOUTUBE_GENRE_LABELS: Record<string, string> = {
  'hip-hop-rap': 'Hip-Hop/Rap',
  pop: 'Pop',
  rnb: 'R&B',
  country: 'Country',
  'rock-alternative': 'Rock/Alternative',
  electronic: 'Electronic',
};

// --- NEXT Feed ---
// See the FeedEvent type's own comment (lib/types.ts) for why this is a
// real persisted table rather than the compute-live pattern
// lib/notifications.ts uses. This file only owns writing/reading rows;
// lib/feed-signals.ts owns deciding WHEN an automated (non-user-triggered)
// event is worth creating.

export async function getFeedEvent(id: number): Promise<FeedEvent | undefined> {
  return await db.prepare('SELECT * FROM feed_events WHERE id = ?').get(id) as FeedEvent | undefined;
}

// Returns the created row, or null if a dedupe_key collision meant this
// exact event already existed (ON CONFLICT DO NOTHING — a no-op, not an error,
// since "someone already posted this" is the expected/desired outcome of
// a duplicate call, not a failure). Rows with no dedupe_key always insert.
export async function createFeedEvent(input: {
  eventType: FeedEventType;
  actorUserId?: number;
  artistId?: number;
  refType?: string;
  refId?: number;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}): Promise<FeedEvent | null> {
  const info = await db
    .prepare(`
      INSERT INTO feed_events (event_type, actor_user_id, artist_id, ref_type, ref_id, visibility, metadata, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, 'public', ?, ?, ?)
      ON CONFLICT DO NOTHING
    `)
    .run(
      input.eventType, input.actorUserId ?? null, input.artistId ?? null, input.refType ?? null, input.refId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null, input.dedupeKey ?? null, new Date().toISOString()
    );
  if (info.changes === 0) return null; // dedupe_key already existed
  return await getFeedEvent(info.lastInsertRowid as number) ?? null;
}

// The cooldown check for automated signal events (see lib/feed-signals.ts)
// — "has this exact signal already fired for this artist recently?" A
// sliding time window can't be expressed as a unique-index dedupe_key
// (that only ever means "never/always", not "not within N days"), so this
// is a plain lookup the generator calls before deciding to post.
export async function hasFeedEventSince(eventType: FeedEventType, artistId: number, sinceISO: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM feed_events WHERE event_type = ? AND artist_id = ? AND created_at >= ? LIMIT 1')
    .get(eventType, artistId, sinceISO);
  return Boolean(row);
}

// Newest-first, optionally paged with `beforeId` (strictly less than, so
// paging never re-shows or skips a row even if new events are inserted
// between pages). No feed-ranking/personalization here yet — that's the
// UI-facing PR; this is the plain chronological read the schema needs to
// be genuinely useful and testable on its own.
export async function getFeedEvents(limit = 50, beforeId?: number): Promise<FeedEvent[]> {
  if (beforeId != null) {
    return await db.prepare('SELECT * FROM feed_events WHERE id < ? ORDER BY id DESC LIMIT ?').all(beforeId, limit) as FeedEvent[];
  }
  return await db.prepare('SELECT * FROM feed_events ORDER BY id DESC LIMIT ?').all(limit) as FeedEvent[];
}

export async function getFeedEventCount(): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS c FROM feed_events').get() as { c: number }).c;
}

// Same anti-spam-not-fraud-detection posture as TRADE_RATE_LIMIT_PER_MINUTE
// above — a reaction is low-stakes, so this is generous, just enough to
// stop one account hammering the endpoint faster than any real person taps.
export const REACTION_RATE_LIMIT_PER_MINUTE = 30;

// Reads feed_reaction_taps (see its own comment in the DDL above), not
// feed_reactions — the latter is mutable and would undercount a user
// rapidly toggling the same reaction on and off, since each "off" deletes
// its own row.
export async function getRecentReactionCount(userId: number, minutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const row = await db.prepare('SELECT COUNT(*) AS c FROM feed_reaction_taps WHERE user_id = ? AND created_at >= ?').get(userId, cutoff) as { c: number };
  return row.c;
}

// One reaction per user per post — tapping the same reaction again removes
// it (returns null), tapping a different one changes it in place. The
// UNIQUE(feed_event_id, user_id) index is what makes this atomic instead of
// a check-then-write race. Every call — add, change, or remove — logs one
// row to feed_reaction_taps for rate limiting, regardless of outcome.
export async function setFeedReaction(feedEventId: number, userId: number, reactionType: ReactionType): Promise<FeedReaction | null> {
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO feed_reaction_taps (user_id, created_at) VALUES (?, ?)').run(userId, now);

  const existing = await db
    .prepare('SELECT * FROM feed_reactions WHERE feed_event_id = ? AND user_id = ?')
    .get(feedEventId, userId) as FeedReaction | undefined;

  if (existing && existing.reaction_type === reactionType) {
    await db.prepare('DELETE FROM feed_reactions WHERE id = ?').run(existing.id);
    return null;
  }
  if (existing) {
    await db.prepare('UPDATE feed_reactions SET reaction_type = ?, created_at = ? WHERE id = ?').run(reactionType, now, existing.id);
    return { ...existing, reaction_type: reactionType };
  }
  const info = await db
    .prepare('INSERT INTO feed_reactions (feed_event_id, user_id, reaction_type, created_at) VALUES (?, ?, ?, ?)')
    .run(feedEventId, userId, reactionType, now);
  return { id: info.lastInsertRowid as number, feed_event_id: feedEventId, user_id: userId, reaction_type: reactionType, created_at: now };
}

export async function getFeedReactionCounts(feedEventId: number): Promise<Record<ReactionType, number>> {
  const rows = await db
    .prepare('SELECT reaction_type, COUNT(*) AS c FROM feed_reactions WHERE feed_event_id = ? GROUP BY reaction_type')
    .all(feedEventId) as { reaction_type: ReactionType; c: number }[];
  const counts: Record<ReactionType, number> = { fire: 0, eyes: 0, early: 0 };
  for (const row of rows) counts[row.reaction_type] = row.c;
  return counts;
}

// Batch versions of the two lookups above, for rendering a whole page of
// feed items in a fixed number of queries instead of two per card.
export async function getFeedReactionCountsForEvents(feedEventIds: number[]): Promise<Map<number, Record<ReactionType, number>>> {
  const result = new Map<number, Record<ReactionType, number>>();
  if (feedEventIds.length === 0) return result;
  const placeholders = feedEventIds.map(() => '?').join(',');
  const rows = await db
    .prepare(`SELECT feed_event_id, reaction_type, COUNT(*) AS c FROM feed_reactions WHERE feed_event_id IN (${placeholders}) GROUP BY feed_event_id, reaction_type`)
    .all(...feedEventIds) as { feed_event_id: number; reaction_type: ReactionType; c: number }[];
  for (const row of rows) {
    const counts = result.get(row.feed_event_id) ?? { fire: 0, eyes: 0, early: 0 };
    counts[row.reaction_type] = row.c;
    result.set(row.feed_event_id, counts);
  }
  return result;
}

export async function getUserFeedReactionsForEvents(userId: number, feedEventIds: number[]): Promise<Map<number, ReactionType>> {
  const result = new Map<number, ReactionType>();
  if (feedEventIds.length === 0) return result;
  const placeholders = feedEventIds.map(() => '?').join(',');
  const rows = await db
    .prepare(`SELECT feed_event_id, reaction_type FROM feed_reactions WHERE user_id = ? AND feed_event_id IN (${placeholders})`)
    .all(userId, ...feedEventIds) as { feed_event_id: number; reaction_type: ReactionType }[];
  for (const row of rows) result.set(row.feed_event_id, row.reaction_type);
  return result;
}

// --- NEXT Feed: User Take posts ---

export const USER_TAKE_BODY_MAX_LENGTH = 500;
// A post is heavier content than a trade or a tap, so a tighter window
// than TRADE_RATE_LIMIT_PER_MINUTE/REACTION_RATE_LIMIT_PER_MINUTE — still
// generous for genuine use (a real person posting 5 takes in 10 minutes is
// already an unusual pace), tight enough to bound spam.
export const USER_TAKE_RATE_LIMIT_PER_10_MIN = 5;

export async function getRecentUserTakePostCount(userId: number, minutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const row = await db.prepare('SELECT COUNT(*) AS c FROM feed_user_posts WHERE user_id = ? AND created_at >= ?').get(userId, cutoff) as { c: number };
  return row.c;
}

// Business-logic validation lives here (matches executeTrade's own
// ok/error result shape); auth and the rate-limit check above live in the
// route, same split every other Feed-writing route already uses.
export async function createUserTakePost(
  userId: number,
  artistId: number,
  rawBody: string
): Promise<{ ok: true; post: FeedUserPost; event: FeedEvent } | { ok: false; error: string }> {
  const body = rawBody.trim().replace(/\n{3,}/g, '\n\n');
  if (!body) return { ok: false, error: 'Your take can\'t be empty.' };
  if (body.length > USER_TAKE_BODY_MAX_LENGTH) return { ok: false, error: `Keep it under ${USER_TAKE_BODY_MAX_LENGTH} characters.` };

  const artist = await getArtist(artistId);
  if (!artist || artist.stage === 'passed') return { ok: false, error: 'That artist is not on NEXT.' };

  // Prevent a duplicated/rapid-retried submission (a flaky network, an
  // accidental double-tap) from posting the same take twice, without full
  // idempotency-key plumbing — a post isn't financial, so "same user, same
  // artist, same exact text, within the last minute" is a cheap, sufficient
  // guard rather than trade-style client-generated keys.
  const dupCutoff = new Date(Date.now() - 60 * 1000).toISOString();
  const dup = await db
    .prepare('SELECT 1 FROM feed_user_posts WHERE user_id = ? AND artist_id = ? AND body = ? AND created_at >= ? LIMIT 1')
    .get(userId, artistId, body, dupCutoff);
  if (dup) return { ok: false, error: 'You just posted that — give it a moment before posting again.' };

  const now = new Date().toISOString();
  const info = await db
    .prepare('INSERT INTO feed_user_posts (user_id, artist_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, artistId, body, now);
  const post = (await getUserTakePostById(info.lastInsertRowid as number))!;

  // No dedupe_key — every genuine post is meant to create its own event
  // (unlike a signal, a take is never "the same thing happening again").
  const event = (await createFeedEvent({ eventType: 'user_take', actorUserId: userId, artistId, refType: 'user_post', refId: post.id }))!;
  return { ok: true, post, event };
}

export async function getUserTakePostById(id: number): Promise<FeedUserPost | undefined> {
  return await db.prepare('SELECT * FROM feed_user_posts WHERE id = ?').get(id) as FeedUserPost | undefined;
}

export async function getUserTakePostsByIds(ids: number[]): Promise<Map<number, FeedUserPost>> {
  const result = new Map<number, FeedUserPost>();
  if (ids.length === 0) return result;
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT * FROM feed_user_posts WHERE id IN (${placeholders})`).all(...unique) as FeedUserPost[];
  for (const row of rows) result.set(row.id, row);
  return result;
}

// Soft delete only, and only the owner may do it. The feed_events row is
// left in place — lib/feed-items.ts drops any user_take item whose post is
// deleted/hidden at render time, the same "resolve, then filter" pattern
// already used for an item whose artist no longer resolves.
export async function deleteUserTakePost(userId: number, postId: number): Promise<boolean> {
  const info = await db.prepare('UPDATE feed_user_posts SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .run(new Date().toISOString(), postId, userId);
  return info.changes > 0;
}

export async function getUserTakePostsForUser(userId: number): Promise<(FeedUserPost & { artist_name: string })[]> {
  return await db.prepare(`
    SELECT feed_user_posts.*, artists.name AS artist_name
    FROM feed_user_posts
    JOIN artists ON artists.id = feed_user_posts.artist_id
    WHERE feed_user_posts.user_id = ? AND feed_user_posts.deleted_at IS NULL
    ORDER BY feed_user_posts.created_at DESC
  `).all(userId) as (FeedUserPost & { artist_name: string })[];
}

// One report per (post, reporter) — a second report from the same person
// is a silent no-op via the UNIQUE index, not an error.
export async function reportUserTakePost(reporterId: number, postId: number): Promise<void> {
  await db.prepare('INSERT INTO feed_post_reports (post_id, reporter_user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(postId, reporterId, new Date().toISOString());
}

// Admin moderation view — every post with at least one report, newest
// report first, with exactly what a moderator needs: the real account
// behind it (name/email, not just a display name), the artist context, and
// how many people flagged it. report_count is COUNT(*) at read time, never
// a maintained column (see feed_post_reports' own DDL comment).
export async function getReportedUserTakePosts(): Promise<{
  post: FeedUserPost; authorName: string; authorEmail: string; artistName: string; reportCount: number; lastReportedAt: string;
}[]> {
  const rows = await db.prepare(`
    SELECT
      feed_user_posts.*,
      users.name AS author_name, users.email AS author_email,
      artists.name AS artist_name,
      COUNT(feed_post_reports.id) AS report_count,
      MAX(feed_post_reports.created_at) AS last_reported_at
    FROM feed_post_reports
    JOIN feed_user_posts ON feed_user_posts.id = feed_post_reports.post_id
    JOIN users ON users.id = feed_user_posts.user_id
    JOIN artists ON artists.id = feed_user_posts.artist_id
    GROUP BY feed_user_posts.id, users.name, users.email, artists.name
    ORDER BY last_reported_at DESC
  `).all() as any[];
  return rows.map((r) => ({
    post: {
      id: r.id, user_id: r.user_id, artist_id: r.artist_id, body: r.body, created_at: r.created_at,
      deleted_at: r.deleted_at ?? undefined, hidden_at: r.hidden_at ?? undefined, hidden_by: r.hidden_by ?? undefined,
    },
    authorName: r.author_name,
    authorEmail: r.author_email,
    artistName: r.artist_name,
    reportCount: r.report_count,
    lastReportedAt: r.last_reported_at,
  }));
}

export async function hideUserTakePost(adminId: number, postId: number): Promise<boolean> {
  const info = await db.prepare('UPDATE feed_user_posts SET hidden_at = ?, hidden_by = ? WHERE id = ? AND hidden_at IS NULL')
    .run(new Date().toISOString(), adminId, postId);
  return info.changes > 0;
}

export async function unhideUserTakePost(postId: number): Promise<boolean> {
  const info = await db.prepare('UPDATE feed_user_posts SET hidden_at = NULL, hidden_by = NULL WHERE id = ?').run(postId);
  return info.changes > 0;
}

// Composer artist search — substring match over the live NEXT roster,
// capped small since this backs an autocomplete dropdown, not a full
// Discover-style browse. findArtistsByName (above) is exact-match only
// (duplicate-submission checking), not what a search box needs.
export async function searchNextArtists(query: string, limit = 8): Promise<{ id: number; name: string; photo_url?: string; genre?: string }[]> {
  const term = query.trim();
  if (term.length < 1) return [];
  return await db
    .prepare(`
      SELECT id, name, photo_url, genre FROM artists
      WHERE stage != 'passed' AND name ILIKE ? ESCAPE '\\'
      ORDER BY (CASE WHEN LOWER(name) LIKE LOWER(?) THEN 0 ELSE 1 END), name ASC
      LIMIT ?
    `)
    .all(`%${term.replace(/[%_\\]/g, '\\$&')}%`, `${term}%`, limit) as { id: number; name: string; photo_url?: string; genre?: string }[];
}

export async function approveDiscoveryCandidate(id: number, actor: Actor): Promise<Artist | undefined> {
  const candidate = await getDiscoveryCandidate(id);
  if (!candidate || candidate.status === 'approved') return undefined;

  const artist = await createArtist(
    {
      name: candidate.name,
      photo_url: candidate.photo_url,
      location: candidate.country,
      genre: candidate.yt_genre ? (YOUTUBE_GENRE_LABELS[candidate.yt_genre] ?? candidate.yt_genre) : undefined,
      followers_count: candidate.followers_count,
      growth_velocity_pct: candidate.growth_30d_pct,
      soundcharts_uuid: candidate.soundcharts_uuid,
      why_trending: candidate.flagged_reason,
      featured_video_id: candidate.yt_video_id,
      // The Add Artist form always starts all eight rated categories at a
      // neutral 5/10 (see ArtistForm.tsx) rather than leaving them unset —
      // approval bypasses that form entirely and was falling through to
      // createArtist's raw 0 default instead. At weights summing to 100%
      // of the Breakout Score, that meant every freshly-discovered artist
      // scored as "Pass" regardless of how strong the signal that flagged
      // them was. growth_velocity/engagement_quality used to get a real
      // starting value for free here (auto-derived from the candidate's
      // real growth %) — now that both are Scout-manual (pre-beta
      // migration, see the WRITABLE_FIELDS comment above), they get the
      // same neutral 5 as the other six, pending an actual Scout rating.
      music_talent: 5,
      growth_velocity: 5,
      engagement_quality: 5,
      original_song_response: 5,
      brand_personality: 5,
      content_consistency: 5,
      commercial_potential: 5,
      professionalism: 5,
    },
    actor
  );

  await db.prepare('UPDATE discovery_candidates SET status = ?, reviewed_at = ?, reviewed_by = ?, artist_id = ? WHERE id = ?')
    .run('approved', new Date().toISOString(), actor.id, artist.id, id);
  await logDiscoveryCandidateHistory(id, candidate.status, 'approved', actor.id);

  // dedupe_key ties to this specific candidate row, so re-approving (can't
  // happen — the guard at the top returns early on an already-approved
  // candidate) or any future retry can never double-post either event.
  await createFeedEvent({
    eventType: 'new_artist',
    artistId: artist.id,
    refType: 'discovery_candidate',
    refId: id,
    metadata: { genre: artist.genre, score: breakoutScore(artist) },
    dedupeKey: `new_artist:${id}`,
  });
  // A public submission (someone pasted a link on /next/submit-artist)
  // carries real discoverer attribution — see discovery_candidates.
  // submitted_by_user_id. A YouTube-scan or Soundcharts-sourced candidate
  // has no submitter, so it's a New Artist event only, never a "someone
  // found this" one.
  if (candidate.submitted_by_user_id) {
    await createFeedEvent({
      eventType: 'early_discovery',
      actorUserId: candidate.submitted_by_user_id,
      artistId: artist.id,
      refType: 'discovery_candidate',
      refId: id,
      metadata: { followersAtDiscovery: candidate.followers_count, genre: artist.genre },
      dedupeKey: `early_discovery:${id}`,
    });
  }

  return artist;
}

// Artist claims — see the ArtistClaim type's own comment for why this is a
// review queue rather than a direct write to artists.claimed_by_user_id.
const ARTIST_CLAIM_SELECT = `
  SELECT artist_claims.*, artists.name AS artist_name,
         claimants.name AS user_name, claimants.email AS user_email,
         reviewers.name AS reviewed_by_name
  FROM artist_claims
  JOIN artists ON artists.id = artist_claims.artist_id
  JOIN users claimants ON claimants.id = artist_claims.user_id
  LEFT JOIN users reviewers ON reviewers.id = artist_claims.reviewed_by
`;

export async function getArtistClaim(id: number): Promise<ArtistClaim | undefined> {
  return await db.prepare(`${ARTIST_CLAIM_SELECT} WHERE artist_claims.id = ?`).get(id) as ArtistClaim | undefined;
}

export async function getPendingArtistClaims(): Promise<ArtistClaim[]> {
  return await db
    .prepare(`${ARTIST_CLAIM_SELECT} WHERE artist_claims.status = 'pending' ORDER BY artist_claims.created_at ASC`)
    .all() as ArtistClaim[];
}

export async function getPendingArtistClaimCount(): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS c FROM artist_claims WHERE status = 'pending'").get() as { c: number };
  return row.c;
}

export async function getArtistClaimsForUser(userId: number): Promise<ArtistClaim[]> {
  return await db
    .prepare(`${ARTIST_CLAIM_SELECT} WHERE artist_claims.user_id = ? ORDER BY artist_claims.created_at DESC`)
    .all(userId) as ArtistClaim[];
}

export async function getPendingClaimForUserAndArtist(userId: number, artistId: number): Promise<ArtistClaim | undefined> {
  return await db
    .prepare(`${ARTIST_CLAIM_SELECT} WHERE artist_claims.user_id = ? AND artist_claims.artist_id = ? AND artist_claims.status = 'pending'`)
    .get(userId, artistId) as ArtistClaim | undefined;
}

// The only artists a claim's own user_id is allowed to see the Artist
// Dashboard for — see requireArtistOwner in lib/auth.ts.
export async function getArtistsClaimedByUser(userId: number): Promise<Artist[]> {
  return await db.prepare(`${ARTIST_SELECT} WHERE artists.claimed_by_user_id = ? ORDER BY artists.name ASC`).all(userId) as Artist[];
}

// Rejects with a reason string rather than throwing — these are all
// expected, user-facing outcomes (already claimed, duplicate pending
// request), not exceptional failures, so the API route can turn `reason`
// straight into the response instead of every caller needing a try/catch.
export async function createArtistClaim(
  artistId: number,
  userId: number,
  message: string | undefined
): Promise<{ ok: true; claim: ArtistClaim } | { ok: false; reason: string }> {
  const artist = await getArtist(artistId);
  if (!artist) return { ok: false, reason: 'Artist not found.' };
  if (artist.claimed_by_user_id != null) {
    return {
      ok: false,
      reason: artist.claimed_by_user_id === userId ? 'You already claimed this profile.' : 'This profile has already been claimed.',
    };
  }

  try {
    const info = await db
      .prepare('INSERT INTO artist_claims (artist_id, user_id, message, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(artistId, userId, message ?? null, 'pending', new Date().toISOString());
    return { ok: true, claim: (await getArtistClaim(info.lastInsertRowid as number))! };
  } catch (err: any) {
    if (isUniqueViolation(err)) return { ok: false, reason: 'You already have a pending claim on this artist.' };
    throw err;
  }
}

export async function reviewArtistClaim(id: number, decision: 'approved' | 'rejected', actor: Actor): Promise<ArtistClaim | undefined> {
  const existing = await getArtistClaim(id);
  if (!existing || existing.status !== 'pending') return undefined;

  const now = new Date().toISOString();
  await db.prepare('UPDATE artist_claims SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?').run(decision, now, actor.id, id);

  if (decision === 'approved') {
    await db.prepare('UPDATE artists SET claimed_by_user_id = ?, updated_at = ? WHERE id = ?').run(existing.user_id, now, existing.artist_id);
    await addLogEntry(existing.artist_id, { type: 'claim', message: `Profile claim approved for ${existing.user_name ?? `user #${existing.user_id}`}.` }, actor);
  }

  return await getArtistClaim(id);
}
