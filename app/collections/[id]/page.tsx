import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireInternal } from '@/lib/auth';
import { getAllArtists } from '@/lib/db';
import { getCollectionById } from '@/lib/collections';
import { CollectionEditor } from '@/components/CollectionsAdmin';

export const metadata: Metadata = { title: { absolute: 'Edit collection — Scout' } };
export const dynamic = 'force-dynamic';

export default async function EditCollectionPage(props: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const id = Number((await props.params).id);
  const collection = Number.isInteger(id) ? await getCollectionById(id) : undefined;
  if (!collection) notFound();
  const roster = (await getAllArtists()).filter((a) => a.stage !== 'passed').sort((a, b) => a.name.localeCompare(b.name));
  const nameById = new Map(roster.map((a) => [a.id, a.name]));
  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/collections" className="text-sm" style={{ color: 'var(--text-faint)' }}>← All collections</Link>
      <h1 className="text-2xl font-bold">{collection.title}</h1>
      <CollectionEditor
        collection={{ id: collection.id, slug: collection.slug, title: collection.title, description: collection.description ?? '', published: collection.published }}
        items={collection.items.map((i) => ({ artistId: i.artist_id, name: nameById.get(i.artist_id) ?? `Artist #${i.artist_id}`, note: i.note ?? '' }))}
        roster={roster.map((a) => ({ id: a.id, name: a.name }))}
      />
    </div>
  );
}
