'use client';
import { useState } from 'react';
import Link from 'next/link';
import { FeedItemDTO } from '@/lib/feed-items';
import { formatCents, timeAgo } from '@/lib/format';
import { track } from '@/lib/track';
import YouTubePreviewButton from '@/components/next/YouTubePreviewButton';
import WatchButton from '@/components/next/WatchButton';
import ReactionBar from '@/components/next/ReactionBar';
import { heroGradient } from '@/components/next/heroGradient';
import { getArtistAvatarUrl } from '@/lib/artist-image';

// One card shell, six narrative flavors switched on eventType — every
// headline/body string below is built purely from real fields already on
// the DTO (metadata, artist, actor, extra), never invented prose, per the
// spec's "NEXT Signal posts must be auto-generated from real data only."
function cardContent(item: FeedItemDTO, viewerUserId: number): { icon: string; eyebrow: string; headline: string; body?: string } {
  const artistName = item.artist?.name ?? 'An artist';
  const num = (key: string) => (typeof item.metadata[key] === 'number' ? (item.metadata[key] as number) : undefined);

  switch (item.eventType) {
    case 'new_artist':
      return { icon: '🆕', eyebrow: 'New on NEXT', headline: `${artistName} just joined the market` };
    case 'early_discovery':
      return {
        icon: '💎',
        eyebrow: 'Early discovery',
        headline: `${item.actor?.name ?? 'Someone'} found ${artistName} early`,
        body: num('followersAtDiscovery') != null ? `${(num('followersAtDiscovery') as number).toLocaleString()} followers at the time` : undefined,
      };
    case 'artist_update':
      return { icon: '📣', eyebrow: `Update from ${artistName}`, headline: item.extra?.logMessage ?? 'Posted an update', body: undefined };
    case 'founding_believer_share': {
      const isOwn = item.actor?.id === viewerUserId;
      return {
        icon: '🏆',
        eyebrow: item.extra?.founding?.tierLabel ?? 'Founding Believer',
        headline: `${isOwn ? 'You' : (item.actor?.name ?? 'A backer')} shared a Founding Believer card for ${artistName}`,
        body: item.extra?.founding ? `Backer #${item.extra.founding.discoveryRank} · ${item.extra.founding.serial}` : undefined,
      };
    }
    case 'signal_score_up':
    case 'signal_score_down': {
      const up = item.eventType === 'signal_score_up';
      const changeAbs = num('changeAbs') ?? 0;
      return {
        icon: up ? '📈' : '📉',
        eyebrow: 'NEXT Signal',
        headline: `${artistName}'s NEXT Score ${up ? 'jumped' : 'dropped'} ${changeAbs.toFixed(1)} points`,
        body: num('scoreAfter') != null ? `Now at ${(num('scoreAfter') as number).toFixed(0)}` : undefined,
      };
    }
    case 'signal_undervalued':
    case 'signal_overheated': {
      const undervalued = item.eventType === 'signal_undervalued';
      return {
        icon: undervalued ? '🔥' : '⚠️',
        eyebrow: 'NEXT Signal',
        headline: `${artistName} looks ${undervalued ? 'undervalued' : 'overheated'}`,
        body: num('diff') != null ? `Score runs ${Math.abs(num('diff') as number).toFixed(0)} pts ${undervalued ? 'ahead of' : 'behind'} price` : undefined,
      };
    }
    case 'market_momentum_mover': {
      const changePct = num('changePct') ?? 0;
      return {
        icon: changePct >= 0 ? '🚀' : '📉',
        eyebrow: 'Market momentum',
        headline: `${artistName}'s price moved ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% today`,
      };
    }
    case 'market_momentum_backers':
      return { icon: '⚡', eyebrow: 'Market momentum', headline: `${num('backerCount') ?? 'Several'} people backed ${artistName} today` };
    case 'market_momentum_most_watched':
      return { icon: '👀', eyebrow: 'Market momentum', headline: `${num('watchCount') ?? 'Several'} people started watching ${artistName} today` };
    case 'market_momentum_most_discussed':
      return { icon: '💬', eyebrow: 'Market momentum', headline: `${num('takeCount') ?? 'Several'} NEXT users are talking about ${artistName} this week` };
    case 'market_momentum_volume': {
      const changePct = num('changePct') ?? 0;
      return { icon: '📊', eyebrow: 'NEXT Volume', headline: `${artistName}'s NEXT trading volume is up ${changePct.toFixed(0)}% this week` };
    }
    case 'user_take':
      // The one type whose "headline" is real user prose, not a
      // system-generated sentence — the eyebrow carries the author instead
      // of a category label, and the artist gets named in the context row
      // below since it's no longer named in the headline itself.
      return { icon: '💬', eyebrow: `@${item.actor?.name ?? 'A NEXT user'}`, headline: item.extra?.userPost?.body ?? '' };
  }
}

// "Back this artist" for the signal/momentum flavors (this is a market
// event, the artist may be worth a look), "View Artist" for everything
// else (informational — a new roster addition, an update, a discovery/
// collectible moment). Same destination either way, per the spec's MVP
// note that Back Artist just opens Artist Detail/trade panel for now.
const BACK_STYLE_TYPES = new Set<FeedItemDTO['eventType']>([
  'signal_score_up', 'signal_undervalued', 'signal_overheated', 'market_momentum_mover', 'market_momentum_backers', 'market_momentum_most_watched',
  'market_momentum_most_discussed', 'market_momentum_volume',
]);

export default function FeedCard({
  item,
  watching,
  viewerUserId,
  onPostDeleted,
}: {
  item: FeedItemDTO;
  watching: boolean;
  viewerUserId: number;
  // Feed items live in FeedView's client-side list — a successful delete
  // needs to remove this card from that list, not just this component.
  onPostDeleted?: (feedEventId: number) => void;
}) {
  const content = cardContent(item, viewerUserId);
  const artist = item.artist;
  // Avatar only — never a YouTube video-thumbnail stand-in, see
  // lib/artist-image.ts.
  const heroImageUrl = artist ? getArtistAvatarUrl({ photo_url: artist.photoUrl }) : undefined;
  const isBackFlavor = BACK_STYLE_TYPES.has(item.eventType);
  const isOwnFoundingShare = item.eventType === 'founding_believer_share' && item.actor?.id === viewerUserId;
  const isUserTake = item.eventType === 'user_take';
  const isOwnPost = isUserTake && item.extra?.userPost?.isOwn === true;
  const [deleting, setDeleting] = useState(false);
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'reported'>('idle');
  // Carried through Artist Detail into the trade flow (see TradePanel.tsx
  // and the trade route) so a trade completed after arriving from Feed can
  // be attributed back to this specific card — feed_trade_initiated (below)
  // fires the moment the link is clicked; feed_trade_completed fires later,
  // server-side, only if a real trade actually goes through.
  const artistHref = artist ? `/next/artists/${artist.id}?ref=feed&feedEventId=${item.id}` : undefined;

  function trackArtistOpen() {
    track('feed_artist_opened', { feedEventId: item.id, artistId: artist?.id, eventType: item.eventType });
    if (isBackFlavor || isUserTake) track('feed_trade_initiated', { feedEventId: item.id, artistId: artist?.id, eventType: item.eventType });
    // Mirrored so "did a user's take actually cause a listen/watch/trade"
    // is answerable on its own — see the AnalyticsEventType comment.
    if (isUserTake) {
      track('feed_user_post_artist_opened', { feedEventId: item.id, artistId: artist?.id });
      track('feed_user_post_trade_initiated', { feedEventId: item.id, artistId: artist?.id });
    }
  }

  async function deletePost() {
    if (deleting || !item.extra?.userPost) return;
    if (!confirm('Delete this take? This can\'t be undone.')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/next/feed/posts/${item.extra.userPost.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('request failed');
      onPostDeleted?.(item.id);
    } catch {
      setDeleting(false);
    }
  }

  async function reportPost() {
    if (reportState !== 'idle' || !item.extra?.userPost) return;
    setReportState('sending');
    try {
      const res = await fetch(`/api/next/feed/posts/${item.extra.userPost.id}/report`, { method: 'POST' });
      if (!res.ok) throw new Error('request failed');
      setReportState('reported');
    } catch {
      setReportState('idle');
    }
  }

  return (
    <div className="next-card p-4 sm:p-5 flex gap-4">
      {artist && (
        <Link href={artistHref!} onClick={trackArtistOpen} className="shrink-0">
          <div
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden relative flex items-center justify-center"
            style={{ background: heroImageUrl ? undefined : heroGradient(artist.id) }}
          >
            {heroImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Scout-curated/YouTube-thumbnail URL, not a next/image candidate.
              <img src={heroImageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <span className="font-display font-extrabold text-xl" style={{ color: 'oklch(96% 0.01 90 / 0.28)' }}>
                {artist.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
            )}
          </div>
        </Link>
      )}

      <div className="min-w-0 flex-1 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono uppercase tracking-[0.06em]" style={{ color: 'var(--text-faint)' }}>
            {content.icon} {content.eyebrow}
          </span>
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{timeAgo(item.createdAt)}</span>
        </div>

        <p className="m-0 text-[14.5px] font-semibold leading-snug">{content.headline}</p>
        {content.body && <p className="m-0 text-[13px] leading-snug" style={{ color: 'var(--text-muted)' }}>{content.body}</p>}

        {artist && (
          <div className="flex items-center gap-2.5 text-[12.5px] flex-wrap" style={{ color: 'var(--text-faint)' }}>
            {isUserTake && <span className="font-semibold" style={{ color: 'var(--text)' }}>{artist.name}</span>}
            {isUserTake && <span>NEXT Score {artist.score.toFixed(0)}</span>}
            {artist.genre && !isUserTake && <span>{artist.genre}</span>}
            <span className="num" style={{ color: 'var(--text)' }}>{formatCents(artist.priceCents)}</span>
            <span className="num" style={{ color: artist.changePct >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {artist.changePct >= 0 ? '+' : ''}{artist.changePct.toFixed(1)}%
            </span>
          </div>
        )}

        {artist && (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span
              onClickCapture={() => {
                if (!watching) {
                  track('feed_watch_added', { feedEventId: item.id, artistId: artist.id });
                  if (isUserTake) track('feed_user_post_watch', { feedEventId: item.id, artistId: artist.id });
                }
              }}
            >
              <WatchButton artistId={artist.id} initialWatching={watching} />
            </span>
            <span
              onClickCapture={() => {
                track('feed_audio_played', { feedEventId: item.id, artistId: artist.id });
                if (isUserTake) track('feed_user_post_audio_played', { feedEventId: item.id, artistId: artist.id });
              }}
            >
              <YouTubePreviewButton artistId={artist.id} artistName={artist.name} videoId={artist.featuredVideoId} variant="icon" />
            </span>
            {isUserTake ? (
              // The spec's explicit two-button layout for this type — the
              // other ten keep their single dynamic-label button unchanged.
              <>
                <Link href={artistHref!} onClick={trackArtistOpen} className="next-btn-ghost text-center px-4 py-2 rounded-[10px] text-[12.5px] font-bold">
                  View Artist
                </Link>
                <Link href={artistHref!} onClick={trackArtistOpen} className="next-btn-primary text-center px-4 py-2 rounded-[10px] text-[12.5px] font-bold">
                  Back
                </Link>
              </>
            ) : (
              <Link
                href={artistHref!}
                onClick={trackArtistOpen}
                className={`text-center px-4 py-2 rounded-[10px] text-[12.5px] font-bold ${isBackFlavor ? 'next-btn-primary' : 'next-btn-ghost'}`}
              >
                {isBackFlavor ? 'Back this artist' : 'View Artist'}
              </Link>
            )}
            {item.eventType === 'early_discovery' && item.actor && (
              <Link href={`/next/profile/${item.actor.id}`} className="next-btn-ghost text-center px-4 py-2 rounded-[10px] text-[12.5px] font-bold">
                View profile
              </Link>
            )}
            {item.eventType === 'founding_believer_share' && item.actor && (
              // Own share -> the full private receipt page. Someone else's
              // share -> their public Scout Profile, which shows this exact
              // collectible (rank, backed date, followers-then — all
              // already public-safe there) without needing a new route.
              <Link
                href={isOwnFoundingShare ? `/next/artists/${artist.id}/founding-believer` : `/next/profile/${item.actor.id}#founding-${artist.id}`}
                className="next-btn-ghost text-center px-4 py-2 rounded-[10px] text-[12.5px] font-bold"
              >
                {isOwnFoundingShare ? 'View my collectible' : 'View collectible'}
              </Link>
            )}
            {isOwnPost && (
              <button
                type="button"
                onClick={deletePost}
                disabled={deleting}
                className="next-btn-ghost text-center px-4 py-2 rounded-[10px] text-[12.5px] font-bold"
                style={{ color: 'var(--down)' }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            {isUserTake && !isOwnPost && (
              <button
                type="button"
                onClick={reportPost}
                disabled={reportState !== 'idle'}
                className="next-btn-ghost text-center px-4 py-2 rounded-[10px] text-[12.5px] font-bold"
                style={{ color: 'var(--text-faint)' }}
              >
                {reportState === 'reported' ? 'Reported' : reportState === 'sending' ? 'Reporting…' : 'Report'}
              </button>
            )}
          </div>
        )}

        <ReactionBar feedEventId={item.id} initialCounts={item.reactionCounts} initialViewerReaction={item.viewerReaction} />
      </div>
    </div>
  );
}
