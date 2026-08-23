import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getArtist, getFoundingBelieverCountForArtist, getFoundingBelieverRecord, getHolding, getNextArtist, getScoreHistory, isWatchlisted } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { marketSentiment } from '@/lib/next-market';
import AudioPreview from '@/components/AudioPreview';
import SpotifyPreview from '@/components/SpotifyPreview';
import PriceChart from '@/components/PriceChart';
import TradePanel from '@/components/TradePanel';
import VideoBanner from '@/components/next/VideoBanner';
import WatchButton from '@/components/next/WatchButton';
import InfoTip from '@/components/next/InfoTip';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const artist = getArtist(Number(params.id));
  return { title: artist?.name ?? 'Artist' };
}

export const dynamic = 'force-dynamic';

// Public-safe view only: name, genre, location, public socials, public
// growth metrics, NEXT Score, NEXT Price. Deliberately excludes stage,
// scout_name, notes, created_by — that's Scout's internal view, not NEXT's.
export default async function NextArtistPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const row = getNextArtist(id);
  if (!row) notFound();

  const { artist, score, priceCents, priceHistory } = row;
  const sentiment = marketSentiment(score, priceCents);
  const holding = getHolding(user.id, id);
  const scoreHistory = getScoreHistory(id);
  const foundingRecord = getFoundingBelieverRecord(user.id, id);
  const backerCount = getFoundingBelieverCountForArtist(id);
  const watching = isWatchlisted(user.id, id);

  const links = [
    { label: 'Top song', url: artist.top_song_url },
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
    <div className="flex flex-col gap-6">
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
          <AudioPreview artistId={artist.id} artistName={artist.name} src={artist.song_preview_url} />
          <WatchButton artistId={artist.id} initialWatching={watching} variant="labeled" />
        </div>
        {backerCount > 0 && (
          <p className="m-0 text-[12.5px] flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={2}><path d="M8 21h8M12 17v4M17 5V3H7v2M17 5a5 5 0 0 1-5 5 5 5 0 0 1-5-5M17 5h2a2 2 0 0 1-2 4M7 5H5a2 2 0 0 0 2 4" /></svg>
            {backerCount} Scout{backerCount === 1 ? '' : 's'} backed this artist
          </p>
        )}
      </div>

      {artist.bio && <p className="text-[14.5px] leading-relaxed max-w-[68ch] m-0" style={{ color: 'var(--text-muted)' }}>{artist.bio}</p>}

      <SpotifyPreview trackUrl={artist.top_song_url} artistUrl={artist.spotify_url} />

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
          <div className="flex-1">
            <p className="m-0 font-display font-bold text-[14.5px]" style={{ color: 'var(--gold)' }}>Founding Believer</p>
            <p className="mt-[3px] mb-0 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              You backed {artist.name} on {new Date(foundingRecord.purchased_at).toLocaleDateString()}
              {foundingRecord.followers_count != null && (
                <> — <span className="num">{foundingRecord.followers_count.toLocaleString()}</span> followers then, <span className="num">{artist.followers_count?.toLocaleString() ?? '—'}</span> today</>
              )}
              . You were backer <strong style={{ color: 'var(--text)' }}>#{foundingRecord.discovery_rank}</strong>. This stays true even if you sell.
            </p>
          </div>
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
          </div>

          <div className="next-card p-6">
            <h2 className="font-display font-bold text-[17px] m-0 mb-[18px]">Momentum</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Followers</div>
                <div className="num text-[19px] font-bold">{artist.followers_count?.toLocaleString() ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Monthly listeners</div>
                <div className="num text-[19px] font-bold">{artist.monthly_listeners?.toLocaleString() ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>30-day growth</div>
                <div className="num text-[19px] font-bold" style={{ color: 'var(--up)' }}>{artist.growth_velocity_pct != null ? `+${artist.growth_velocity_pct}%` : '—'}</div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Engagement</div>
                <div className="num text-[19px] font-bold">{artist.engagement_rate_pct != null ? `${artist.engagement_rate_pct}%` : '—'}</div>
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
                    style={{ border: '1px solid var(--border-soft)', color: l.label === 'Top song' ? 'var(--text)' : 'var(--text-muted)' }}
                  >
                    {l.label === 'Top song' && <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--text)"><path d="M6 4 20 12 6 20Z" /></svg>}
                    {l.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <TradePanel
          artistId={id}
          priceCents={priceCents}
          ownedShares={holding?.shares ?? 0}
          costBasisCents={holding?.cost_basis_cents ?? 0}
          creditsCents={user.next_credits_cents}
        />
      </div>
    </div>
  );
}
