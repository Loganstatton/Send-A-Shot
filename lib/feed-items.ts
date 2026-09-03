// Turns raw feed_events rows into render-ready FeedItemDTOs for NEXT Feed —
// parses metadata, resolves the artist/actor/ref data each card needs, and
// precomputes the plain 0..1 ranking-factor inputs lib/feed-ranking.ts's
// (isomorphic, no-db-access) scoring function consumes. Server-only: this
// file imports lib/db.ts and must never be imported by client components —
// see lib/feed-ranking.ts's comment on why it only takes this file's
// *type*, not its code.

import {
  getBackedArtistIds, getFeedReactionCountsForEvents, getFoundingBelieverRecordById, getLogEntryById, getNextArtistsByIds,
  getScoreChanges, getUserFeedReactionsForEvents, getUsersByIds, getUserTakePostsByIds, getWatchlistArtistIds,
} from './db';
import { ALERT_PRICE_PCT_THRESHOLD, ALERT_SCORE_THRESHOLD, changePctForWindow, changePctSinceListing } from './next-market';
import { getFoundingBelieverTier, foundingBelieverSerial } from './founding-believer';
import { MIN_BACKERS_FOR_MOMENTUM, MIN_WATCHERS_FOR_MOMENTUM } from './feed-signals';
import { FeedEvent, FeedEventType, FeedUserPost, NextMarketRow, ReactionType, ScoreChange, User } from './types';

const EMPTY_REACTION_COUNTS: Record<ReactionType, number> = { fire: 0, eyes: 0, early: 0 };

export type FeedItemDTO = {
  id: number;
  eventType: FeedEventType;
  createdAt: string;
  actor?: { id: number; name: string };
  artist?: {
    id: number;
    name: string;
    genre?: string;
    location?: string;
    photoUrl?: string;
    featuredVideoId?: string;
    score: number;
    priceCents: number;
    changePct: number;
  };
  metadata: Record<string, unknown>;
  extra?: {
    logMessage?: string;
    founding?: { tierKey: string; tierLabel: string; serial: string; discoveryRank: number };
    userPost?: { id: number; body: string; isOwn: boolean };
  };
  reactionCounts: Record<ReactionType, number>;
  viewerReaction: ReactionType | null;
  factors: {
    isFollowed: boolean;
    genreMatch: boolean;
    baseStrength: number;
    unusualness: number;
    momentum: number;
    engagement: number;
  };
};

export type FeedAssemblyContext = {
  viewerUserId: number;
  followedArtistIds: Set<number>; // watched ∪ backed, for the viewer this feed is being built for
  favoriteGenres: Set<string>; // genres of the artists in followedArtistIds
  marketByArtistId: Map<number, NextMarketRow>;
  scoreChanges: Record<number, ScoreChange>;
  usersById: Map<number, User>;
  reactionCountsByEventId: Map<number, Record<ReactionType, number>>;
  viewerReactionByEventId: Map<number, ReactionType>;
  userPostsByRefId: Map<number, FeedUserPost>;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// How "exciting" this event type inherently is, independent of any
// particular event's numbers — a deliberate, visible ranking input rather
// than an implicit ordering. Tune freely.
const EVENT_TYPE_BASE_STRENGTH: Record<FeedEventType, number> = {
  new_artist: 0.5,
  early_discovery: 0.6,
  artist_update: 0.35,
  founding_believer_share: 0.45,
  signal_score_up: 0.7,
  signal_score_down: 0.4,
  signal_undervalued: 0.75,
  signal_overheated: 0.55,
  market_momentum_mover: 0.8,
  market_momentum_backers: 0.65,
  market_momentum_most_watched: 0.6,
  // A real opinion, but not inherently more exciting than a factual market
  // event — reactions (the engagement factor) are what should actually
  // carry a strong take upward, not this baseline.
  user_take: 0.4,
};

// How far past the "worth posting at all" threshold an event's own numbers
// are — reuses the exact thresholds lib/feed-signals.ts used to decide
// whether to create the event, scaled so 3x the threshold reads as maximally
// unusual, rather than inventing a second set of magic numbers here.
function unusualness(eventType: FeedEventType, metadata: Record<string, unknown>): number {
  const num = (key: string) => (typeof metadata[key] === 'number' ? (metadata[key] as number) : 0);
  switch (eventType) {
    case 'signal_score_up':
    case 'signal_score_down':
      return clamp01(Math.abs(num('changeAbs')) / (ALERT_SCORE_THRESHOLD * 3));
    case 'signal_undervalued':
    case 'signal_overheated':
      return clamp01(Math.abs(num('diff')) / 12); // SENTIMENT_THRESHOLD (4, not exported) * 3
    case 'market_momentum_mover':
      return clamp01(Math.abs(num('changePct')) / (ALERT_PRICE_PCT_THRESHOLD * 3));
    case 'market_momentum_backers':
      return clamp01(num('backerCount') / (MIN_BACKERS_FOR_MOMENTUM * 3));
    case 'market_momentum_most_watched':
      return clamp01(num('watchCount') / (MIN_WATCHERS_FOR_MOMENTUM * 3));
    default:
      return 0.2;
  }
}

// Is this artist broadly heating up right now, independent of which
// specific event triggered this feed item — blends recent score movement
// and 24h price movement, each scaled against the same "significant"
// thresholds Watchlist alerts already use.
function artistMomentum(artistId: number | undefined, ctx: FeedAssemblyContext): number {
  if (artistId == null) return 0;
  const row = ctx.marketByArtistId.get(artistId);
  if (!row) return 0;
  const scoreComponent = clamp01(Math.abs(ctx.scoreChanges[artistId]?.changeAbs ?? 0) / (ALERT_SCORE_THRESHOLD * 2));
  const pricePct = changePctForWindow(row.priceCents, row.priceHistory, 24);
  const priceComponent = clamp01(Math.abs(pricePct) / (ALERT_PRICE_PCT_THRESHOLD * 2));
  return (scoreComponent + priceComponent) / 2;
}

function parseMetadata(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function buildArtistDTO(row: NextMarketRow): FeedItemDTO['artist'] {
  const { artist, score, priceCents, priceHistory } = row;
  return {
    id: artist.id,
    name: artist.name,
    genre: artist.genre,
    location: artist.location,
    photoUrl: artist.photo_url,
    featuredVideoId: artist.featured_video_id,
    score,
    priceCents,
    changePct: changePctSinceListing(priceCents, priceHistory),
  };
}

function buildExtra(event: FeedEvent, ctx: FeedAssemblyContext): FeedItemDTO['extra'] {
  if (event.event_type === 'artist_update' && event.ref_type === 'contact_log' && event.ref_id != null) {
    const entry = getLogEntryById(event.ref_id);
    return entry ? { logMessage: entry.message } : undefined;
  }
  if (event.event_type === 'founding_believer_share' && event.ref_type === 'founding_believer' && event.ref_id != null) {
    const record = getFoundingBelieverRecordById(event.ref_id);
    if (!record) return undefined;
    const tier = getFoundingBelieverTier(record.discovery_rank);
    return {
      founding: {
        tierKey: tier.key,
        tierLabel: tier.label,
        // The serial needs the artist's name for its initials, which this
        // helper doesn't have (only the event row) — buildFeedItem below
        // fills in the real value once it has resolved the artist DTO.
        serial: '',
        discoveryRank: record.discovery_rank,
      },
    };
  }
  if (event.event_type === 'user_take' && event.ref_type === 'user_post' && event.ref_id != null) {
    const post = ctx.userPostsByRefId.get(event.ref_id);
    if (!post || post.deleted_at || post.hidden_at) return undefined;
    return { userPost: { id: post.id, body: post.body, isOwn: post.user_id === ctx.viewerUserId } };
  }
  return undefined;
}

function buildFeedItem(event: FeedEvent, ctx: FeedAssemblyContext): FeedItemDTO {
  const metadata = parseMetadata(event.metadata);
  const marketRow = event.artist_id != null ? ctx.marketByArtistId.get(event.artist_id) : undefined;
  const artist = marketRow ? buildArtistDTO(marketRow) : undefined;
  const actorUser = event.actor_user_id != null ? ctx.usersById.get(event.actor_user_id) : undefined;

  let extra = buildExtra(event, ctx);
  if (extra?.founding && artist) {
    extra = { founding: { ...extra.founding, serial: foundingBelieverSerial(artist.name, extra.founding.discoveryRank) } };
  }

  const reactionCounts = ctx.reactionCountsByEventId.get(event.id) ?? EMPTY_REACTION_COUNTS;
  const totalReactions = reactionCounts.fire + reactionCounts.eyes + reactionCounts.early;

  return {
    id: event.id,
    eventType: event.event_type,
    createdAt: event.created_at,
    actor: actorUser ? { id: actorUser.id, name: actorUser.name } : undefined,
    artist,
    metadata,
    extra,
    reactionCounts,
    viewerReaction: ctx.viewerReactionByEventId.get(event.id) ?? null,
    factors: {
      isFollowed: artist != null && ctx.followedArtistIds.has(artist.id),
      genreMatch: artist?.genre != null && ctx.favoriteGenres.has(artist.genre),
      baseStrength: EVENT_TYPE_BASE_STRENGTH[event.event_type],
      unusualness: unusualness(event.event_type, metadata),
      momentum: artistMomentum(event.artist_id, ctx),
      // How much real reaction activity this specific item has drawn —
      // scaled against a modest "10 reactions is already a lot at this
      // scale" ceiling rather than the roster-wide thresholds above, since
      // reaction counts are a different kind of number (small, per-item).
      engagement: clamp01(totalReactions / 10),
    },
  };
}

// Events referencing an artist that no longer resolves (deleted/never
// matched) are dropped rather than rendered half-blank — real data only,
// same rule the spec applies to the events themselves. A user_take whose
// post was deleted by its author or hidden by a moderator is dropped the
// same way — the feed_events row stays (so its id/timestamp never gets
// reused), but nothing renders for it, for anyone.
export function buildFeedItems(events: FeedEvent[], ctx: FeedAssemblyContext): FeedItemDTO[] {
  return events
    .filter((e) => e.artist_id == null || ctx.marketByArtistId.has(e.artist_id))
    .filter((e) => {
      if (e.event_type !== 'user_take') return true;
      const post = e.ref_id != null ? ctx.userPostsByRefId.get(e.ref_id) : undefined;
      return post != null && !post.deleted_at && !post.hidden_at;
    })
    .map((e) => buildFeedItem(e, ctx));
}

// Shared by the Feed page's initial server render and the pagination API
// route (app/api/next/feed/route.ts), so "load more" resolves context
// identically instead of drifting from what the first batch used. Loads
// market rows for every artist this batch of events references PLUS every
// artist the viewer follows (so relevance/genre-affinity still work for a
// followed artist even when this particular batch has no event for them).
export function buildFeedAssemblyContext(userId: number, events: FeedEvent[]): FeedAssemblyContext {
  const followedArtistIds = new Set([...getWatchlistArtistIds(userId), ...getBackedArtistIds(userId)]);
  const eventArtistIds = events.map((e) => e.artist_id).filter((id): id is number => id != null);
  const marketByArtistId = getNextArtistsByIds([...new Set([...eventArtistIds, ...followedArtistIds])]);

  const favoriteGenres = new Set<string>();
  for (const id of followedArtistIds) {
    const genre = marketByArtistId.get(id)?.artist.genre;
    if (genre) favoriteGenres.add(genre);
  }

  const actorIds = events.map((e) => e.actor_user_id).filter((id): id is number => id != null);
  const eventIds = events.map((e) => e.id);
  const userPostRefIds = events.filter((e) => e.event_type === 'user_take' && e.ref_id != null).map((e) => e.ref_id as number);
  return {
    viewerUserId: userId,
    followedArtistIds,
    favoriteGenres,
    marketByArtistId,
    scoreChanges: getScoreChanges(),
    usersById: getUsersByIds(actorIds),
    reactionCountsByEventId: getFeedReactionCountsForEvents(eventIds),
    viewerReactionByEventId: getUserFeedReactionsForEvents(userId, eventIds),
    userPostsByRefId: getUserTakePostsByIds(userPostRefIds),
  };
}
