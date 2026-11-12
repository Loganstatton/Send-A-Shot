import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getSessionUser } from '@/lib/auth';
import { getNextArtistsByIds, logEvent } from '@/lib/db';
import { getCollectionBySlug } from '@/lib/collections';
import { getArtistAvatarUrl } from '@/lib/artist-image';
import ArtistAvatar from '@/components/ArtistAvatar';

export const dynamic = 'force-dynamic';

async function load(slug: string) {
  const collection = await getCollectionBySlug(slug);
  if (!collection) return null;
  const viewer = await getSessionUser();
  const isStaff = !!viewer && viewer.role !== 'public';
  // Drafts are visible to staff only (as a preview); everyone else gets 404.
  if (!collection.published && !isStaff) return null;
  return { collection, viewer, isStaff };
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const collection = await getCollectionBySlug(slug);
  if (!collection || !collection.published) return { title: 'Collection', robots: { index: false } };
  const description = collection.description ?? `A collection of emerging artists picked by NEXT's Scouts.`;
  return { title: collection.title, description, openGraph: { title: collection.title, description }, twitter: { card: 'summary', title: collection.title, description } };
}

export default async function CollectionPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const data = await load(slug);
  if (!data) notFound();
  const { collection, viewer } = data;
  const rows = await getNextArtistsByIds(collection.items.map((i) => i.artist_id));
  await logEvent(viewer?.id ?? null, 'discover_viewed', { collection: collection.slug, ...(viewer ? {} : { guest: true }) });

  return (
    <div className="flex flex-col gap-6 max-w-[780px]">
      {!collection.published && (
        <p role="status" className="m-0 text-sm px-4 py-2.5 rounded-lg border" style={{ borderColor: 'var(--ember-line)', color: 'var(--ember)' }}>
          Draft preview — only staff can see this until it&apos;s published.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="m-0 text-xs font-mono uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>Collection · picked by our Scouts</p>
        <h1 className="font-display font-bold text-[32px] m-0 tracking-[-0.01em]">{collection.title}</h1>
        {collection.description && <p className="m-0 text-base leading-relaxed" style={{ color: 'var(--text-muted)' }}>{collection.description}</p>}
      </div>
      <ol className="flex flex-col gap-2.5 list-none p-0 m-0">
        {collection.items.map((item, i) => {
          const row = rows.get(item.artist_id);
          if (!row) return null;
          return (
            <li key={item.artist_id}>
              <Link href={`/next/artists/${row.artist.id}`} className="next-card next-card-hover flex items-center gap-4 px-5 py-4">
                <span className="num w-6 text-sm shrink-0" style={{ color: 'var(--text-faint)' }}>{i + 1}</span>
                <ArtistAvatar name={row.artist.name} photoUrl={getArtistAvatarUrl(row.artist)} />
                <div className="min-w-0 flex-1">
                  <div className="font-display font-semibold truncate">{row.artist.name}</div>
                  {item.note && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{item.note}</div>}
                  {row.artist.genre && <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{row.artist.genre}</div>}
                </div>
                <span className="text-xs shrink-0 hidden sm:inline" style={{ color: 'var(--text-faint)' }}>Listen →</span>
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="m-0 text-xs" style={{ color: 'var(--text-faint)' }}>
        Collections are editorial picks by NEXT&apos;s Scouts. Artists can&apos;t pay to be included.
      </p>
    </div>
  );
}
