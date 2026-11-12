import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getArtist, getArtistTradeVolumeCents, getBackerCountsByArtist, getFoundingBelieverCountForArtist,
  getFoundingBelieverRecord, getHolding, getNextArtist, getPendingClaimForUserAndArtist, getRecentBackerCount,
  getNextMarket, getPublicScoreChanges, getRecentTradesForArtist, getScoreHistory, getWatchCountsByArtist, isWatchlisted, logEvent,
} from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { hubForGenre } from '@/lib/genre-hubs';
import { getArtistAvatarUrl } from '@/lib/artist-image';
import { marketSentiment } from '@/lib/next-market';
import { formatCents } from '@/lib/format';
import SpotifyPreview from '@/components/SpotifyPreview';
import PriceChart from '@/components/PriceChart';
import TradePanel from '@/components/TradePanel';
import VideoBanner from '@/components/next/VideoBanner';
import WatchButton from '@/components/next/WatchButton';
import InfoTip from '@/components/next/InfoTip';
import ScoreExplainer from '@/components/next/ScoreExplainer';
import ArtistRequestForm from '@/components/next/ArtistRequestForm';
import { PUBLIC_KINDS, REQUEST_KIND_LABELS } from '@/lib/artist-requests';
import RecentActivity from '@/components/next/RecentActivity';
import ClaimArtistPanel from '@/components/next/ClaimArtistPanel';
import MobileTradeBar from '@/components/next/MobileTradeBar';
import GuestBackPanel from '@/components/next/GuestBackPanel';

// What a shared artist link previews as (iMessage, X, Discord, etc.).
// Built from the public projection only — nothing Scout-internal.
export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const id = Number(params.id);
  const row = Number.isInteger(id) ? await getNextArtist(id) : undefined;
  if (!row) return { title: 'Artist' };
  const { artist } = row;
  const where = [artist.genre, artist.location].filter(Boolean).join(' · ');
  const description = `${artist.name}${where ? ` — ${where}` : ''}. Listen, and back them early on NEXT.`;
  const image = getArtistAvatarUrl(artist) ?? (artist.featured_video_id ? `https://img.youtube.com/vi/${artist.featured_video_id}/hqdefault.jpg` : undefined);
  return {
    title: artist.name,
    description,
    openGraph: { title: `${artist.name} on NEXT`, description, type: 'profile', images: image ? [image] : undefined },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: `${artist.name} on NEXT`, description, images: image ? [image] : undefined },
  };
}

export const dynamic = 'force-dynamic';

// Public-safe view only: name, genre, location, public socials, public
// growth metrics, NEXT Score, NEXT Price. Deliberately excludes stage,
// scout_name, notes, created_by — that's Scout's internal view, not NEXT's.
// Viewable signed out (this is the page shared links land on); the
// personal parts — holding, watch state, claim, trading — need an account.
export default async function NextArtistPage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ ref?: string; feedEventId?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const user = await getSessionUser();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  // A trade completed on this page can be attributed back to the Feed card
  // that linked here (see FeedCard.tsx and TradePanel.tsx) — purely
  // additive analytics, never touches trade validation/idempotency/market
  // integrity, all of which lives in executeTrade untouched.
  const feedEventIdParam = Number(searchParams.feedEventId);
  const feedReferralEventId = searchParams.ref === 'feed' && Number.isInteger(feedEventIdParam) ? feedEventIdParam : undefined;
  const row = await getNextArtist(id);
  if (!row) notFound();
  await logEvent(user?.id ?? null, 'artist_detail_opened', user ? { artistId: id } : { artistId: id, guest: true });

  const { artist, score, priceCents, priceHistory } = row;
  // A few things on this page (the Score-contribution breakdown, the claim-
  // ownership check) need raw Artist fields that row.artist deliberately
  // excludes now that it's the public-safe projection (see PublicArtist in
  // lib/types.ts) — fetched here, server-side only, never passed as a prop
  // into a 'use client' component itself (only the derived, already-safe
  // scoreParts/claimState values below are).
  const rawArtist = (await getArtist(id))!;
  const sentiment = marketSentiment(score, priceCents);
  const holding = user ? await getHolding(user.id, id) : undefined;
  const scoreHistory = await getScoreHistory(id);
  const foundingRecord = user ? await getFoundingBelieverRecord(user.id, id) : undefined;
  const earlyBackerCount = await getFoundingBelieverCountForArtist(id); // ever-first-bought — see the Founding Believer module below
  const currentBackerCount = (await getBackerCountsByArtist())[id] ?? 0; // currently holding shares right now
  const watchCount = (await getWatchCountsByArtist())[id] ?? 0;
  const watching = user ? await isWatchlisted(user.id, id) : false;
  const scoreChanges = await getPublicScoreChanges(id);
  // Previous/next in Discover's default order (highest Score first), so a
  // listener can move straight on to the next artist.
  const ordered = [...(await getNextMarket())].sort((a, b) => b.score - a.score);
  const position = ordered.findIndex((r) => r.artist.id === id);
  const prevArtist = position > 0 ? ordered[position - 1].artist : null;
  const nextArtist = position >= 0 && position < ordered.length - 1 ? ordered[position + 1].artist : null;
  const genreHub = await hubForGenre(row.artist.genre);
  const volumeCents24h = await getArtistTradeVolumeCents(id, 24);
  const recentBackerCount24h = await getRecentBackerCount(id, 24);
  const recentTrades = await getRecentTradesForArtist(id);
  const claimState =
    !user
      ? null
      : rawArtist.claimed_by_user_id == null
      ? ((await getPendingClaimForUserAndArtist(user.id, id)) ? 'pending' as const : 'unclaimed' as const)
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
      ? `Our Scouts rate ${artist.name} ${Math.round(sentiment.diff)} points higher than the current NEXT Price implies — the players haven't come around to the Scouts' view yet. If you agree with the Scouts, this is where you'd act; if you don't, they could be wrong.`
      : sentiment.tone === 'overheated'
      ? `The market has priced ${artist.name} ${Math.round(Math.abs(sentiment.diff))} points above our Scouts' rating — players are more excited than the Scouts are. That can mean the Scouts are behind, or the price has run ahead of itself.`
      : null;

  return (
    <div className="flex flex-col gap-6 pb-20 lg:pb-0">
      <nav aria-label="Artist navigation" className="flex items-center justify-between gap-3 flex-wrap text-[13px]">
        <Link href="/next" className="flex items-center gap-1.5 w-fit" style={{ color: 'var(--text-faint)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 18 9 12l6-6" /></svg>
          Back to Discover
        </Link>
        {(prevArtist || nextArtist) && (
          <div className="flex items-center gap-3">
            {prevArtist && (
              <Link href={`/next/artists/${prevArtist.id}`} rel="prev" className="next-btn-ghost px-3 py-1.5 rounded-lg max-w-[180px] truncate">
                ← <span className="sr-only">Previous artist: </span>{prevArtist.name}
              </Link>
            )}
            {nextArtist && (
              <Link href={`/next/artists/${nextArtist.id}`} rel="next" className="next-btn-ghost px-3 py-1.5 rounded-lg max-w-[180px] truncate">
                <span className="sr-only">Next artist: </span>{nextArtist.name} →
              </Link>
            )}
          </div>
        )}
      </nav>

      <VideoBanner artistId={artist.id} name={artist.name} videoId={artist.featured_video_id} photoUrl={artist.photo_url} />

      <div className="flex flex-col gap-2.5">
        <div>
          <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">{artist.name}</h1>
          <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
            {genreHub ? (
              <Link href={`/next/genres/${genreHub.slug}`} className="underline-offset-2 hover:underline">{artist.genre}</Link>
            ) : artist.genre}
            {artist.genre && artist.location ? ' · ' : ''}{artist.location}
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-[5px] rounded-lg border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-soft)' }}>
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-faint)' }}>SCORE</span>
            <span className="num text-[15px] font-bold">{score.toFixed(0)}</span>
            <InfoTip
              label="NEXT Score"
              text="Our Scouts' own read on this artist's momentum — growth, engagement, and buzz, boiled into one number. Compare it to NEXT Price below to see if the market agrees."
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
              {sentiment.tone === 'undervalued' ? `Scouts rate +${Math.round(sentiment.diff)} vs. market` : `Market +${Math.round(Math.abs(sentiment.diff))} vs. Scouts`}
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

      {claimState ? (
        <ClaimArtistPanel artistId={id} artistName={artist.name} initialState={claimState} />
      ) : rawArtist.claimed_by_user_id == null ? (
        <p className="m-0 text-[13px]" style={{ color: 'var(--text-faint)' }}>
          Are you {artist.name}?{' '}
          <Link href={`/signup?next=${encodeURIComponent(`/next/artists/${id}`)}`} className="underline">Sign up to claim this profile</Link>{' '}
          and post updates to your fans.
        </p>
      ) : null}

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
            <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--border-soft)' }}>
              <ScoreExplainer ratings={rawArtist} rationale={rawArtist.score_rationale} scoredAt={rawArtist.scored_at} changes={scoreChanges} />
            </div>
          </div>

          <div className="next-card p-6">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-[18px]">
              <h2 className="font-display font-bold text-[17px] m-0">Activity on NEXT</h2>
              <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>Players on NEXT, right now</span>
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

          {/* Verified Momentum — the third signal, alongside the Scout's
              Score and the game's Price. There is no licensed source of
              verified streaming/social growth yet, so say so instead of
              showing nothing (or something that isn't verified). */}
          <section aria-labelledby="verified-momentum" className="next-card p-6 flex flex-col gap-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 id="verified-momentum" className="font-display font-bold text-[17px] m-0">Verified Momentum</h2>
              <span className="text-[11.5px] px-2.5 py-1 rounded-full border" style={{ color: 'var(--text-faint)', borderColor: 'var(--border-soft)' }}>Not available yet</span>
            </div>
            <p className="m-0 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              NEXT doesn&apos;t yet have a licensed source of verified real-world growth — streams, listeners or followers over time —
              so none is shown here. When it does, this will show the numbers with their source and the date they were last updated.
              The Score above is a Scout&apos;s rating, and the Price comes from players trading virtual credits.
            </p>
          </section>

          <RecentActivity trades={recentTrades} />
        </div>

        {!user ? (
          <GuestBackPanel artistId={id} artistName={artist.name} priceCents={priceCents} />
        ) : (
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
        )}
      </div>

      <details className="next-card px-5 py-4 text-sm">
        <summary className="cursor-pointer" style={{ color: 'var(--text-faint)' }}>Report a problem with this profile</summary>
        <div className="mt-4">
          {user ? (
            claimState === 'owned_by_me' ? (
              <p className="m-0" style={{ color: 'var(--text-muted)' }}>
                This is your profile — use your <Link href={`/next/my-artist/${id}`} className="underline">artist dashboard</Link> for corrections, rating reviews or removal.
              </p>
            ) : (
              <ArtistRequestForm
                artistId={id}
                idPrefix="public-request"
                kinds={PUBLIC_KINDS.map((k) => ({
                  value: k,
                  label: REQUEST_KIND_LABELS[k],
                  hint: k === 'correction'
                    ? 'Something here is factually wrong (name, genre, links, photo).'
                    : k === 'impersonation'
                    ? 'This profile, photo or link pretends to be someone it isn’t.'
                    : 'Someone who isn’t this artist has claimed the profile. If you are the artist, say how we can verify you.',
                }))}
              />
            )
          ) : (
            <p className="m-0" style={{ color: 'var(--text-muted)' }}>
              <Link href={`/login?next=${encodeURIComponent(`/next/artists/${id}`)}`} className="underline">Log in</Link> to report a problem, so we can follow up with you.
            </p>
          )}
        </div>
      </details>

      <MobileTradeBar artistName={artist.name} priceCents={priceCents} changePct={todayChangePct} />
    </div>
  );
}
