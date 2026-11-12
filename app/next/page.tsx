import Link from 'next/link';
import type { Metadata } from 'next';
import {
  getBackerCountsByArtist, getNextMarket, getScoreChanges, getWatchCountsByArtist, getWatchlistArtistIds,
  logArtistCardViews, logEvent,
} from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { marketSentiment, NEXT_STARTING_CREDITS_CENTS } from '@/lib/next-market';
import { formatCents } from '@/lib/format';
import { NextMarketRow } from '@/lib/types';
import DiscoverGrid from '@/components/next/DiscoverGrid';
import NextStatTile from '@/components/next/NextStatTile';
import FeaturedArtist from '@/components/next/FeaturedArtist';
import { getGenrePrefs } from '@/lib/genre-prefs';
import { getWeeklyChallenges } from '@/lib/challenges';
import ChallengesCard from '@/components/next/ChallengesCard';
import { getGenreHubs } from '@/lib/genre-hubs';
import { getCollections } from '@/lib/collections';
import ArtistAvatar from '@/components/ArtistAvatar';
import { getArtistAvatarUrl } from '@/lib/artist-image';

export const metadata: Metadata = {
  title: { absolute: "NEXT — Discover tomorrow's biggest artists" },
  description:
    "Listen to emerging musicians, back the ones you believe in with free virtual credits, and get a permanent record that you found them first.",
};
export const dynamic = 'force-dynamic';

// Market-wide stats only appear once there's enough activity for them to
// mean something. On a new or quiet market "0 backers" and "None right now"
// tell a first-time visitor nothing except that nobody is here.
const MIN_BACKERS_FOR_STATS = 10;
const MIN_ARTISTS_FOR_STATS = 3;
const MIN_MOVE_PCT = 0.5;
const NEW_ARTIST_DAYS = 14;

// Public: a signed-out visitor gets the pitch and can browse every artist;
// backing, watching and everything personal asks them to sign up first.
export default async function NextMarketPage(props: { searchParams: Promise<{ sort?: string; view?: string }> }) {
  const { sort: initialSort, view } = await props.searchParams;
  const user = await getSessionUser();
  const rows = await getNextMarket();
  const watchedIds = user ? await getWatchlistArtistIds(user.id) : [];
  const watchCounts = await getWatchCountsByArtist();
  const backerCounts = await getBackerCountsByArtist();
  const scoreChanges = await getScoreChanges();
  const genrePrefs = user ? await getGenrePrefs(user.id) : [];
  const challenges = user && rows.length > 0 ? await getWeeklyChallenges(user.id) : null;
  const genreHubs = rows.length > 0 ? (await getGenreHubs()).filter((h) => h.count > 0) : [];
  const collections = rows.length > 0 ? (await getCollections({ publishedOnly: true })).slice(0, 3) : [];
  // "New on NEXT": artists added in the last two weeks, newest first —
  // only shown when there are some, never as an empty row.
  const newCutoff = new Date(Date.now() - NEW_ARTIST_DAYS * 86_400_000).toISOString();
  const newArtists = rows.filter((r) => r.artist.created_at >= newCutoff).sort((a, b) => (b.artist.created_at > a.artist.created_at ? 1 : -1)).slice(0, 4);

  // Batched, not per-card impression tracking (no client-side scroll
  // observer or one network round trip per card) — "viewed" here means
  // "was in the results this page load returned," logged in one write.
  if (user) {
    await logEvent(user.id, 'discover_viewed');
    await logArtistCardViews(user.id, rows.map((r) => r.artist.id));
  } else {
    await logEvent(null, 'discover_viewed', { guest: true });
  }

  // First-party in place of the old Soundcharts-derived "Avg. 30D growth"
  // stat — real NEXT activity (currently-held positions across the whole
  // roster) instead of an external platform metric.
  const totalBackers = Object.values(backerCounts).reduce((a, b) => a + b, 0);

  let biggestMover: { name: string; changePct: number } | null = null;
  let biggestGap: { name: string; diff: number } | null = null;
  // The artist our Scouts rate furthest above the market is Discover's
  // featured pick — falls back to the highest Score overall when Scouts and
  // market agree everywhere, so the module never just disappears.
  let featured: NextMarketRow | null = null;
  let featuredRank = -Infinity;
  for (const row of rows) {
    const first = row.priceHistory[0]?.price_cents ?? row.priceCents;
    const changePct = first !== 0 ? ((row.priceCents - first) / first) * 100 : 0;
    if (!biggestMover || Math.abs(changePct) > Math.abs(biggestMover.changePct)) {
      biggestMover = { name: row.artist.name, changePct };
    }
    const sentiment = marketSentiment(row.score, row.priceCents);
    if (sentiment.tone === 'undervalued' && (!biggestGap || sentiment.diff > biggestGap.diff)) {
      biggestGap = { name: row.artist.name, diff: sentiment.diff };
    }
    const rank = sentiment.tone === 'undervalued' ? 1000 + sentiment.diff : row.score;
    if (rank > featuredRank) {
      featuredRank = rank;
      featured = row;
    }
  }

  type Stat = { label: string; value: string; valueTone?: 'up' | 'down' | 'ember'; delta?: string; deltaTone?: 'up' | 'down' | 'ember' };
  const stats: Stat[] = [];
  if (rows.length >= MIN_ARTISTS_FOR_STATS && totalBackers >= MIN_BACKERS_FOR_STATS) {
    stats.push({ label: 'Artists live', value: String(rows.length) });
    stats.push({ label: 'Total backers', value: totalBackers.toLocaleString(), valueTone: 'up' });
    if (biggestMover && Math.abs(biggestMover.changePct) >= MIN_MOVE_PCT) {
      stats.push({
        label: 'Biggest price move',
        value: biggestMover.name,
        delta: `${biggestMover.changePct >= 0 ? '+' : ''}${biggestMover.changePct.toFixed(1)}%`,
        deltaTone: biggestMover.changePct >= 0 ? 'up' : 'down',
      });
    }
    if (biggestGap) {
      stats.push({ label: 'Scouts most ahead of market', value: biggestGap.name, delta: `+${biggestGap.diff.toFixed(0)}`, deltaTone: 'ember' });
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-5 max-w-[760px]">
        <h1 className="font-display font-bold text-[32px] sm:text-[40px] lg:text-[46px] leading-[1.08] lg:leading-[1.05] tracking-[-0.015em] m-0" style={{ textWrap: 'balance' } as React.CSSProperties}>
          Discover tomorrow&apos;s biggest artists. <span style={{ color: 'var(--ember)' }}>Prove you found them first.</span>
        </h1>
        <p className="text-base leading-relaxed m-0 max-w-[60ch]" style={{ color: 'var(--text-muted)' }}>
          Listen to emerging musicians our Scouts are tracking, back the ones you believe in with free virtual
          credits, and get a permanent, dated record that you were early.{' '}
          <Link href="/next/how-it-works" className="underline underline-offset-2" style={{ color: 'var(--text)' }}>How scoring works</Link>
        </p>
        {!user && (
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/signup" className="next-btn-primary px-5 py-3 rounded-[10px] text-[14.5px] font-bold">Start scouting — it&apos;s free</Link>
            {rows.length > 0 && <a href="#artists" className="next-btn-ghost px-5 py-3 rounded-[10px] text-[14.5px]">Browse artists first</a>}
          </div>
        )}
      </div>

      {!user && (
        <section aria-labelledby="how-it-works" className="flex flex-col gap-4">
          <h2 id="how-it-works" className="text-xs uppercase tracking-[0.08em] font-mono m-0" style={{ color: 'var(--text-faint)' }}>How it works</h2>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-3 list-none p-0 m-0">
            {[
              { n: '1', title: 'Listen', body: 'Hear official videos from emerging artists our Scouts are watching — no account needed.' },
              {
                n: '2',
                title: 'Back',
                body: `Sign up and get ${formatCents(NEXT_STARTING_CREDITS_CENTS)} in virtual credits. Back the artists you believe in before everyone else does.`,
              },
              { n: '3', title: 'Prove it', body: 'Your first backing is stamped with your backer number and date — permanently. If they break out, you have the receipt.' },
            ].map((step) => (
              <li key={step.n} className="next-card p-5 flex flex-col gap-2">
                <span className="num text-xs font-bold" style={{ color: 'var(--ember)' }}>{step.n}</span>
                <span className="font-display font-bold text-lg">{step.title}</span>
                <span className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{step.body}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs m-0" style={{ color: 'var(--text-faint)' }}>
            NEXT is a game. Credits are virtual, can&apos;t be bought or cashed out, and backing an artist doesn&apos;t give you any
            ownership of their music or earnings.
          </p>
        </section>
      )}

      {challenges && <ChallengesCard week={challenges} />}

      {stats.length > 0 && (
        <div
          className={`grid grid-cols-1 sm:grid-cols-2 ${stats.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-px rounded-2xl overflow-hidden border`}
          style={{ background: 'var(--border-soft)', borderColor: 'var(--border-soft)' }}
        >
          {stats.map((s) => <NextStatTile key={s.label} {...s} />)}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="next-card text-center py-14 px-6 flex flex-col items-center gap-3">
          <p className="font-display font-bold text-xl m-0">The first artists are on their way.</p>
          <p className="text-sm m-0 max-w-[48ch]" style={{ color: 'var(--text-muted)' }}>
            Our Scouts are reviewing emerging musicians right now. Know someone who should be here?
          </p>
          <Link href={user ? '/next/submit-artist' : '/signup?next=%2Fnext%2Fsubmit-artist'} className="next-btn-primary px-5 py-2.5 rounded-[10px] text-sm font-semibold">
            Suggest an artist
          </Link>
        </div>
      ) : (
        <div id="artists" className="flex flex-col gap-10 scroll-mt-6">
          {featured && <FeaturedArtist row={featured} />}
          {collections.length > 0 && (
            <section aria-labelledby="collections" className="flex flex-col gap-3">
              <h2 id="collections" className="text-xs uppercase tracking-[0.08em] font-mono m-0" style={{ color: 'var(--text-faint)' }}>Collections from our Scouts</h2>
              <ul className="grid grid-cols-1 md:grid-cols-3 gap-2.5 list-none p-0 m-0">
                {collections.map((c) => (
                  <li key={c.id}>
                    <Link href={`/next/collections/${c.slug}`} className="next-card next-card-hover flex flex-col gap-1 px-5 py-4 h-full">
                      <span className="font-display font-semibold">{c.title}</span>
                      {c.description && <span className="text-sm line-clamp-2" style={{ color: 'var(--text-muted)' }}>{c.description}</span>}
                      <span className="text-xs mt-auto" style={{ color: 'var(--text-faint)' }}>{c.itemCount} {c.itemCount === 1 ? 'artist' : 'artists'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {newArtists.length > 0 && rows.some((r) => r.artist.created_at < newCutoff) && (
            <section aria-labelledby="new-on-next" className="flex flex-col gap-3">
              <h2 id="new-on-next" className="text-xs uppercase tracking-[0.08em] font-mono m-0" style={{ color: 'var(--text-faint)' }}>New on NEXT</h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 list-none p-0 m-0">
                {newArtists.map((r) => (
                  <li key={r.artist.id}>
                    <Link href={`/next/artists/${r.artist.id}`} className="next-card next-card-hover flex items-center gap-3 px-4 py-3">
                      <ArtistAvatar name={r.artist.name} photoUrl={getArtistAvatarUrl(r.artist)} size="sm" />
                      <div className="min-w-0">
                        <div className="font-display font-semibold truncate">{r.artist.name}</div>
                        <div className="text-xs truncate" style={{ color: 'var(--text-faint)' }}>
                          {r.artist.genre ? `${r.artist.genre} · ` : ''}added {new Date(r.artist.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* Keyed on the genre picks so Discover re-opens on "For you" right
              after onboarding saves them (it was already mounted behind
              the dialog, with no picks yet). */}
          {genreHubs.length > 1 && (
            <nav aria-label="Browse by genre" className="flex items-center gap-2 flex-wrap text-[13px]">
              <span style={{ color: 'var(--text-faint)' }}>Browse by genre:</span>
              {genreHubs.map((h) => (
                <Link key={h.slug} href={`/next/genres/${h.slug}`} className="next-pill">{h.label}</Link>
              ))}
            </nav>
          )}
          <DiscoverGrid key={`${genrePrefs.join('|')}:${initialSort ?? ''}:${view ?? ''}`} initialSort={initialSort} initialScoutsHigher={view === 'scouts-higher'} rows={rows} watchedIds={watchedIds} watchCounts={watchCounts} backerCounts={backerCounts} scoreChanges={scoreChanges} genrePrefs={genrePrefs} />
        </div>
      )}
    </div>
  );
}
