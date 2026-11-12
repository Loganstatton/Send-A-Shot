import type { Metadata } from 'next';
import { requireInternal } from '@/lib/auth';
import { getCollections } from '@/lib/collections';
import { CollectionsList } from '@/components/CollectionsAdmin';

export const metadata: Metadata = { title: { absolute: 'Collections — Scout' } };
export const dynamic = 'force-dynamic';

export default async function CollectionsAdminPage() {
  await requireInternal();
  const collections = await getCollections();
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Editorial collections</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Curated lists of artists shown on NEXT&apos;s Discover page once published. Drafts are only visible here.
        </p>
      </div>
      <CollectionsList initial={collections.map((c) => ({ id: c.id, slug: c.slug, title: c.title, published: c.published, itemCount: c.itemCount }))} />
    </div>
  );
}
