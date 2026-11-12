import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getSessionUser } from '@/lib/auth';
import { getBackerCountsByArtist, getScoreChanges, getWatchCountsByArtist, getWatchlistArtistIds, logEvent } from '@/lib/db';
import { getGenreHub } from '@/lib/genre-hubs';
import DiscoverGrid from '@/components/next/DiscoverGrid';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const data = await getGenreHub(slug);
  if (!data) return { title: 'Genre' };
  const title = `${data.hub.label} artists to watch — NEXT`;
  const description = `Emerging ${data.hub.label} artists our Scouts are tracking. Listen, back the ones you believe in, and prove you found them first.`;
  return { title: { absolute: title }, description, openGraph: { title, description }, twitter: { card: 'summary', title, description } };
}

// Public genre page: every artist matching the genre, using the same grid
// (search, sort, filters) as Discover.
export default async function GenreHubPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const data = await getGenreHub(slug);
  if (!data) notFound();
  const { hub, rows } = data;
  const user = await getSessionUser();
  const [watchedIds, watchCounts, backerCounts, scoreChanges] = await Promise.all([
    user ? getWatchlistArtistIds(user.id) : Promise.resolve([] as number[]),
    getWatchCountsByArtist(),
    getBackerCountsByArtist(),
    getScoreChanges(),
  ]);
  await logEvent(user?.id ?? null, 'discover_viewed', { genreHub: hub.slug, ...(user ? {} : { guest: true }) });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href="/next/genres" className="text-[13px] w-fit" style={{ color: 'var(--text-faint)' }}>← All genres</Link>
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">{hub.label}</h1>
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          {rows.length > 0
            ? `${rows.length} emerging ${hub.label} ${rows.length === 1 ? 'artist' : 'artists'} our Scouts are tracking.`
            : `No ${hub.label} artists on NEXT yet.`}
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="next-card text-center py-12 px-6 flex flex-col items-center gap-3">
          <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>Know a {hub.label} artist who should be here?</p>
          <Link href={user ? '/next/submit-artist' : '/signup?next=%2Fnext%2Fsubmit-artist'} className="next-btn-primary px-5 py-2.5 rounded-[10px] text-sm font-semibold">Suggest an artist</Link>
        </div>
      ) : (
        <DiscoverGrid rows={rows} watchedIds={watchedIds} watchCounts={watchCounts} backerCounts={backerCounts} scoreChanges={scoreChanges} />
      )}
    </div>
  );
}
