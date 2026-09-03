import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getArtist, getArtistTradeVolumeCents, getBackerCountsByArtist, getFoundingBelieverCountForArtist,
  getFoundingBelieverRecord, getHolding, getNextArtist, getPendingClaimForUserAndArtist, getRecentBackerCount,
  getRecentTradesForArtist, getScoreHistory, getWatchCountsByArtist, isWatchlisted, logEvent,
} from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { marketSentiment } from '@/lib/next-market';
import { scoreContributors } from '@/lib/scoring';
import { formatCents } from '@/lib/format';
import SpotifyPreview from '@/components/SpotifyPreview';
import PriceChart from '@/components/PriceChart';
import TradePanel from '@/components/TradePanel';
import VideoBanner from '@/components/next/VideoBanner';
import WatchButton from '@/components/next/WatchButton';
import InfoTip from '@/components/next/InfoTip';
import ScoreContributorBar from '@/components/next/ScoreContributorBar';
import RecentActivity from '@/components/next/RecentActivity';
import ClaimArtistPanel from '@/components/next/ClaimArtistPanel';
import MobileTradeBar from '@/components/next/MobileTradeBar';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const artist = getArtist(Number(params.id));
  return { title: artist?.name ?? 'Artist' };
}

export const dynamic = 'force-dynamic';

// Public-safe view only: name, genre, location, public socials, public
// growth metrics, NEXT Score, NEXT Price. Deliberately excludes stage,
// scout_name, notes, created_by — that's Scout's internal view, not NEXT's.
export default async function NextArtistPage({ params, searchParams }: { params: { id: string }; searchParams: { ref?: string; feedEventId?: string } }) {
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  // A trade completed on this page can be attributed back to the Feed card
  // that linked here (see FeedCard.tsx and TradePanel.tsx) — purely
  // additive analytics, never touches trade validation/idempotency/market
  // integrity, all of which lives in executeTrade untouched.
  const feedEventIdParam = Number(searchParams.feedEventId);
  const feedReferralEventId = searchParams.ref === 'feed' && Number.isInteger(feedEventIdParam) ? feedEventIdParam : undefined;
  const row = getNextArtist(id);
  if (!row) notFound();
  logEvent(user.id, 'artist_detail_opened', { artistId: id });

  const { artist, score, priceCents, priceHistory } = row;
  // A few things on this page (the Score-contribution breakdown, the claim-
  // ownership check) need raw Artist fields that row.artist deliberately
  // excludes now that it's the public-safe projection (see PublicArtist in
  // lib/types.ts) — fetched here, server-side only, never passed as a prop
  // into a 'use client' component itself (only the derived, already-safe
  // scoreParts/claimState values below are).
  const rawArtist = getArtist(id)!;
  const sentiment = marketSentiment(score, priceCents);
  const holding = getHolding(user.id, id);
  const scoreHistory = getScoreHistory(id);
  const foundingRecord = getFoundingBelieverRecord(user.id, id);
  const earlyBackerCount = getFoundingBelieverCountForArtist(id); // ever-first-bought — see the Founding Believer module below
  const currentBackerCount = getBackerCountsByArtist()[id] ?? 0; // currently holding shares right now
  const watchCount = getWatchCountsByArtist()[id] ?? 0;
  const watching = isWatchlisted(user.id, id);
  const scoreParts = scoreContributors(rawArtist);
  const volumeCents24h = getArtistTradeVolumeCents(id, 24);
  const recentBackerCount24h = getRecentBackerCount(id, 24);
  const recentTrades = getRecentTradesForArtist(id);
  const claimState =
    rawArtist.claimed_by_user_id == null
      ? (getPendingClaimForUserAndArtist(user.id, id) ? 'pending' as const : 'unclaimed' as const)
      : rawArtist.claimed_by_user_id === user.id
      ? 'owned_by_me' as const
      : 'claimed_by_other' as const;

  // "Today" — the same 24h-window idea DiscoverGrid's "Trending today" sort
  // uses, just computed here for a single artist's price display instead
  // of a sort key.
  const todayCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const todayFirst = priceHistory.filter((p) => new Date(p.recorded_at).getTime() >= todayCutoff)[0]?.price_cents ?? priceHistory[0]?.price_cents ?? priceCents;
  const todayChangePct = todayFirst !== 0 ? ((priceCents - todayFirst) / todayFirst) * 100 : 0;

  const links = [
    { label: 'TikTok', url: artist.tiktok_url },
    { label: 'Instagram', url: artist.instagram_url },
    { label: 'YouTube', url: artist.youtube_url },
    { label: 'Spotify', url: artist.spotify_url },
    { label: 'SoundCloud', url: artist.soundcloud_url },
  ].filter((l): l is { label: string; url: string } => Boolean(l.url));

  const signalCopy =
    sentiment.tone === 'undervalued'
      ? `Signal detected — NEXT Score is running ${Math.round(sentiment.diff)} points ahead of what NEXT Price implies. The market hasn't priced in the fundamentals yet.`
      : sentiment.tone === 'overheated'
      ? `Heads up — NEXT Price is running ${Math.round(Math.abs(sentiment.diff))} points ahead of what NEXT Score supports. The market may be ahead of the fundamentals.`
      : null;

  return (
    <div className="flex flex-col gap-6 pb-20 lg:pb-0">
      <Link href="/next" className="text-[13px] flex items-center gap-1.5 w-fit" style={{ color: 'var(--text-faint)' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 18 9 12l6-6" /></svg>
        Back to Discover
      </Link>

      <VideoBanner artistId={artist.id} name={artist.name} videoId={artist.featured_video_id} photoUrl={artist.photo_url} />

      <div className="flex flex-col gap-2.5">
        <div>
          <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">{artist.name}</h1>
          <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
            {artist.genre}{artist.genre && artist.location ? ' · ' : ''}{artist.location}
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-[5px] rounded-lg border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-soft)' }}>
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-faint)' }}>SCORE</span>
            <span className="num text-[15px] font-bold">{score.toFixed(0)}</span>
            <InfoTip
              label="NEXT Score"
              text="Our read on this artist's real momentum — growth, engagement, and buzz, boiled into one number. Compare it to NEXT Price below to see if the market agrees."
            />
          </div>
          {sentiment.tone !== 'fair' && (
            <div
              className="flex items-center gap-1.5 px-3 py-[5px] rounded-lg border text-[12.5px] font-semibold"
              style={
                sentiment.tone === 'undervalued'
                  ? { background: 'var(--ember-dim)', borderColor: 'var(--ember-line)', color: 'var(--ember)' }
                  : { background: 'var(--down-dim)', borderColor: 'var(--down)', color: 'var(--down)' }
              }
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
              {sentiment.tone === 'undervalued' ? 'Undervalued' : 'Overheated'} by {Math.round(Math.abs(sentiment.diff))}
            </div>
          )}
          <div
            className="flex items-center gap-1 px-3 py-[5px] rounded-lg text-[12.5px] font-semibold num"
            style={{ color: todayChangePct >= 0 ? 'var(--up)' : 'var(--down)' }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill={todayChangePct >= 0 ? 'var(--up)' : 'var(--down)'}>
              {todayChangePct >= 0 ? <path d="M12 4 20 16H4Z" /> : <path d="M12 20 4 8h16Z" />}
            </svg>
            {todayChangePct >= 0 ? '+' : ''}{todayChangePct.toFixed(1)}% today
          </div>
          <WatchButton artistId={artist.id} initialWatching={watching} variant="labeled" />
        </div>
        <p className="m-0 text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
          <span className="num">{currentBackerCount}</span> {currentBackerCount === 1 ? 'backer' : 'backers'} right now · <span className="num">{watchCount}</span> watching
        </p>
        {earlyBackerCount > 0 && (
          <p className="m-0 text-[12.5px] flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={2}><path d="M8 21h8M12 17v4M17 5V3H7v2M17 5a5 5 0 0 1-5 5 5 5 0 0 1-5-5M17 5h2a2 2 0 0 1-2 4M7 5H5a2 2 0 0 0 2 4" /></svg>
            {earlyBackerCount} Scout{earlyBackerCount === 1 ? '' : 's'} backed this artist
          </p>
        )}
      </div>

      {artist.bio && <p className="text-[14.5px] leading-relaxed max-w-[68ch] m-0" style={{ color: 'var(--text-muted)' }}>{artist.bio}</p>}

      <SpotifyPreview artistUrl={artist.spotify_url} />

      <ClaimArtistPanel artistId={id} artistName={artist.name} initialState={claimState} />

      {signalCopy && (
        <div
          className="flex items-center gap-3.5 px-5 py-4 rounded-2xl border"
          style={
            sentiment.tone === 'undervalued'
              ? { background: 'var(--ember-dim)', borderColor: 'var(--ember-line)' }
              : { background: 'var(--down-dim)', borderColor: 'var(--down)' }
          }
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={sentiment.tone === 'undervalued' ? 'var(--ember)' : 'var(--down)'} strokeWidth={2} className="shrink-0"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
          <p className="m-0 text-[13.5px] leading-relaxed" style={{ color: 'oklch(90% 0.04 40)' }}>{signalCopy}</p>
        </div>
      )}

      {foundingRecord && (
        <div
          className="flex items-center gap-4 px-[22px] py-[18px] rounded-2xl border"
          style={{ background: 'linear-gradient(120deg, var(--gold-dim), transparent 70%), var(--surface)', borderColor: 'var(--gold-line)' }}
        >
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--gold-dim)', border: '1px solid var(--gold-line)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={2}><path d="M8 21h8M12 17v4M17 5V3H7v2M17 5a5 5 0 0 1-5 5 5 5 0 0 1-5-5M17 5h2a2 2 0 0 1-2 4M7 5H5a2 2 0 0 0 2 4" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="m-0 font-display font-bold text-[14.5px]" style={{ color: 'var(--gold)' }}>Founding Believer</p>
            <p className="mt-[3px] mb-0 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              You backed {artist.name} on {new Date(foundingRecord.purchased_at).toLocaleDateString()}. You were backer{' '}
              <strong style={{ color: 'var(--text)' }}>#{foundingRecord.discovery_rank}</strong>. This stays true even if you sell.
            </p>
            <p className="mt-1.5 mb-0 text-xs" style={{ color: 'var(--text-faint)' }}>
              Score <span className="num">{foundingRecord.next_score.toFixed(0)}</span> then → <span className="num">{score.toFixed(0)}</span> now
              {' · '}
              Price <span className="num">{formatCents(foundingRecord.next_price_cents)}</span> then → <span className="num">{formatCents(priceCents)}</span> now
            </p>
          </div>
          <Link
            href={`/next/artists/${id}/founding-believer`}
            className="next-btn-primary text-xs px-3.5 py-2 rounded-lg shrink-0 whitespace-nowrap"
            style={{ background: 'var(--gold)', color: 'oklch(15% 0.02 90)' }}
          >
            View receipt
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 items-start">
        <div className="flex flex-col gap-5">
          <div className="next-card p-6">
            <div className="text-xs uppercase tracking-[0.06em] font-mono mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}>
              NEXT Price
              <InfoTip label="NEXT Price" text="What the market currently pays for this artist — everyone else's trades, not our own model. When it disagrees with NEXT Score, that's the signal." />
            </div>
            <PriceChart points={priceHistory.map((p) => ({ recorded_at: p.recorded_at, value: p.price_cents }))} format="cents" />
          </div>

          <div className="next-card p-6">
            <div className="text-xs uppercase tracking-[0.06em] font-mono mb-1.5" style={{ color: 'var(--text-faint)' }}>NEXT Score</div>
            <PriceChart
              points={scoreHistory.map((s) => ({ recorded_at: s.recorded_at, value: s.breakout_score }))}
              format="number"
              color="var(--ember)"
            />
            <p className="mt-3.5 mb-0 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
              This is the fundamentals history — see when the algorithm spotted momentum before the price caught up.
            </p>
            <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--border-soft)' }}>
              <div className="text-xs uppercase tracking-[0.06em] font-mono mb-3" style={{ color: 'var(--text-faint)' }}>Why the Score is what it is</div>
              <div className="flex flex-col gap-2.5">
                <ScoreContributorBar label="Real growth &amp; engagement data" points={scoreParts.realDataPoints} total={scoreParts.total} color="var(--up)" />
                <ScoreContributorBar label="Scout evaluation" points={scoreParts.scoutPoints} total={scoreParts.total} color="var(--ember)" />
              </div>
              <p className="mt-3 mb-0 text-[12px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                Growth Velocity and Engagement Quality come straight from real follower/engagement numbers. The rest is a Scout&apos;s own judgment call on talent, brand, and execution — not something a formula can measure.
              </p>
            </div>
          </div>

          <div className="next-card p-6">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-[18px]">
              <h2 className="font-display font-bold text-[17px] m-0">Momentum</h2>
              <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>On NEXT right now</span>
            </div>
            {/* First-party — computed live from NEXT's own trading/watch
                activity, not an external platform's numbers. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Backers</div>
                <div className="num text-[19px] font-bold">{currentBackerCount.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Watching</div>
                <div className="num text-[19px] font-bold">{watchCount.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>24h volume</div>
                <div className="num text-[19px] font-bold">{formatCents(volumeCents24h)}</div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>New backers (24h)</div>
                <div className="num text-[19px] font-bold" style={{ color: recentBackerCount24h > 0 ? 'var(--up)' : undefined }}>
                  {recentBackerCount24h > 0 ? '+' : ''}{recentBackerCount24h.toLocaleString()}
                </div>
              </div>
            </div>
            {links.length > 0 && (
              <div className="flex gap-2.5 flex-wrap mt-5 pt-5" style={{ borderTop: '1px solid var(--border-soft)' }}>
                {links.map((l) => (
                  <a
                    key={l.label}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px]"
                    style={{ border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <RecentActivity trades={recentTrades} />
        </div>

        <TradePanel
          artistId={id}
          artistName={artist.name}
          priceCents={priceCents}
          ownedShares={holding?.shares ?? 0}
          costBasisCents={holding?.cost_basis_cents ?? 0}
          creditsCents={user.next_credits_cents}
          volumeCents24h={volumeCents24h}
          recentBackerCount24h={recentBackerCount24h}
          feedReferralEventId={feedReferralEventId}
        />
      </div>

      <MobileTradeBar artistName={artist.name} priceCents={priceCents} changePct={todayChangePct} />
    </div>
  );
}
