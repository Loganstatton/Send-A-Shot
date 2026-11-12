import Link from 'next/link';
import type { Metadata } from 'next';
import { getGenreHubs } from '@/lib/genre-hubs';

export const metadata: Metadata = {
  title: 'Genres',
  description: 'Browse emerging artists on NEXT by genre.',
};
export const dynamic = 'force-dynamic';

export default async function GenresPage() {
  const hubs = await getGenreHubs();
  return (
    <div className="flex flex-col gap-6 max-w-[780px]">
      <div>
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Browse by genre</h1>
        <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-muted)' }}>Emerging artists our Scouts are tracking, by the music they make.</p>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 list-none p-0 m-0">
        {hubs.map((h) => (
          <li key={h.slug}>
            <Link href={`/next/genres/${h.slug}`} className="next-card next-card-hover flex items-center justify-between px-5 py-4">
              <span className="font-display font-semibold">{h.label}</span>
              <span className="text-xs num" style={{ color: 'var(--text-faint)' }}>{h.count} {h.count === 1 ? 'artist' : 'artists'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
