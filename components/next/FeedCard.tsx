'use client';
import Link from 'next/link';
import { FeedItemDTO } from '@/lib/feed-items';
import { formatCents, timeAgo } from '@/lib/format';
import { track } from '@/lib/track';
import AudioPreview from '@/components/AudioPreview';
import WatchButton from '@/components/next/WatchButton';
import ReactionBar from '@/components/next/ReactionBar';
import { heroGradient } from '@/components/next/heroGradient';

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
  }
}

// "Back this artist" for the signal/momentum flavors (this is a market
// event, the artist may be worth a look), "View Artist" for everything
// else (informational — a new roster addition, an update, a discovery/
// collectible moment). Same destination either way, per the spec's MVP
// note that Back Artist just opens Artist Detail/trade panel for now.
const BACK_STYLE_TYPES = new Set<FeedItemDTO['eventType']>([
  'signal_score_up', 'signal_undervalued', 'signal_overheated', 'market_momentum_mover', 'market_momentum_backers', 'market_momentum_most_watched',
]);

export default function FeedCard({ item, watching, viewerUserId }: { item: FeedItemDTO; watching: boolean; viewerUserId: number }) {
  const content = cardContent(item, viewerUserId);
  const artist = item.artist;
  const heroImageUrl = artist ? (artist.photoUrl || (artist.featuredVideoId ? `https://img.youtube.com/vi/${artist.featuredVideoId}/hqdefault.jpg` : undefined)) : undefined;
  const isBackFlavor = BACK_STYLE_TYPES.has(item.eventType);
  const isOwnFoundingShare = item.eventType === 'founding_believer_share' && item.actor?.id === viewerUserId;

  function trackArtistOpen() {
    track('feed_artist_opened', { feedEventId: item.id, artistId: artist?.id, eventType: item.eventType });
    if (isBackFlavor) track('feed_trade_initiated', { feedEventId: item.id, artistId: artist?.id, eventType: item.eventType });
  }

  return (
    <div className="next-card p-4 sm:p-5 flex gap-4">
      {artist && (
        <Link href={`/next/artists/${artist.id}`} onClick={trackArtistOpen} className="shrink-0">
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
            {artist.genre && <span>{artist.genre}</span>}
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
                if (!watching) track('feed_watch_added', { feedEventId: item.id, artistId: artist.id });
              }}
            >
              <WatchButton artistId={artist.id} initialWatching={watching} />
            </span>
            <span onClickCapture={() => track('feed_audio_played', { feedEventId: item.id, artistId: artist.id })}>
              <AudioPreview artistId={artist.id} artistName={artist.name} src={artist.songPreviewUrl} variant="icon" />
            </span>
            <Link
              href={`/next/artists/${artist.id}`}
              onClick={trackArtistOpen}
              className={`text-center px-4 py-2 rounded-[10px] text-[12.5px] font-bold ${isBackFlavor ? 'next-btn-primary' : 'next-btn-ghost'}`}
            >
              {isBackFlavor ? 'Back this artist' : 'View Artist'}
            </Link>
            {item.eventType === 'early_discovery' && item.actor && (
              <Link href={`/next/profile/${item.actor.id}`} className="next-btn-ghost text-center px-4 py-2 rounded-[10px] text-[12.5px] font-bold">
                View profile
              </Link>
            )}
            {isOwnFoundingShare && (
              <Link href={`/next/artists/${artist.id}/founding-believer`} className="next-btn-ghost text-center px-4 py-2 rounded-[10px] text-[12.5px] font-bold">
                View my collectible
              </Link>
            )}
          </div>
        )}

        <ReactionBar feedEventId={item.id} initialCounts={item.reactionCounts} initialViewerReaction={item.viewerReaction} />
      </div>
    </div>
  );
}
