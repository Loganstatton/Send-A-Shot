import Link from 'next/link';
import type { Metadata } from 'next';
import WorkCard from '@/components/gallery/WorkCard';
import { listArtworks } from '@/lib/gallery/db';
import { ArtworkCategory, Availability, CATEGORY_LABELS } from '@/lib/gallery/types';

export const metadata: Metadata = { title: 'The Works' };

const AVAILABILITY_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'available', label: 'Available' },
  { key: 'sold', label: 'Sold' },
];

const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'original', label: 'Original' },
  { key: 'edition', label: 'Limited Edition' },
];

const CATEGORY_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All Collections' },
  ...(Object.entries(CATEGORY_LABELS) as [ArtworkCategory, string][]).map(([key, label]) => ({ key, label })),
];

function buildHref(base: Record<string, string>, patch: Record<string, string>) {
  const merged = { ...base, ...patch };
  const params = new URLSearchParams();
  Object.entries(merged).forEach(([k, v]) => {
    if (v && v !== 'all') params.set(k, v);
  });
  const qs = params.toString();
  return `/gallery/works${qs ? `?${qs}` : ''}`;
}

export default function WorksPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const availability = searchParams.availability ?? 'all';
  const type = searchParams.type ?? 'all';
  const category = searchParams.category ?? 'all';

  let artworks = listArtworks();

  if (availability === 'available') artworks = artworks.filter((a) => a.availability === 'available' || a.availability === 'reserved');
  if (availability === 'sold') artworks = artworks.filter((a) => a.availability === 'sold' || a.availability === 'private_collection');
  if (type === 'original') artworks = artworks.filter((a) => a.is_original);
  if (type === 'edition') artworks = artworks.filter((a) => a.edition_total != null);
  if (category !== 'all') artworks = artworks.filter((a) => a.categories.includes(category as ArtworkCategory));

  const current = { availability, type, category };

  return (
    <div className="max-w-[1600px] mx-auto px-5 sm:px-8 pt-32 sm:pt-40 pb-28">
      <header className="mb-16 max-w-2xl">
        <p className="g-label mb-4">The Works</p>
        <h1 className="g-serif text-[clamp(2rem,5vw,3.4rem)] leading-tight">A documented body of original drawings.</h1>
      </header>

      <div className="flex flex-col gap-4 mb-16 g-hairline-soft pt-8">
        <FilterRow label="Availability" options={AVAILABILITY_FILTERS} activeKey={availability} paramKey="availability" current={current} />
        <FilterRow label="Type" options={TYPE_FILTERS} activeKey={type} paramKey="type" current={current} />
        <FilterRow label="Collection" options={CATEGORY_FILTERS} activeKey={category} paramKey="category" current={current} />
      </div>

      {artworks.length === 0 ? (
        <p style={{ color: 'var(--g-text-muted)' }}>No works match this filter yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-16">
          {artworks.map((artwork) => (
            <WorkCard key={artwork.id} artwork={artwork} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label,
  options,
  activeKey,
  paramKey,
  current,
}: {
  label: string;
  options: { key: string; label: string }[];
  activeKey: string;
  paramKey: string;
  current: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
      <span className="g-label w-full sm:w-32 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = activeKey === o.key;
          return (
            <Link
              key={o.key}
              href={buildHref(current, { [paramKey]: o.key })}
              className="g-tag"
              style={active ? { color: 'var(--g-black)', background: 'var(--g-offwhite)', borderColor: 'var(--g-offwhite)' } : undefined}
            >
              {o.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
