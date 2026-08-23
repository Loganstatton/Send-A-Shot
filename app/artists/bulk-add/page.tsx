import type { Metadata } from 'next';
import Link from 'next/link';
import BulkAddArtists from '@/components/BulkAddArtists';
import { requireInternal } from '@/lib/auth';

export const metadata: Metadata = { title: { absolute: 'Bulk add artists — Scout' } };
export const dynamic = 'force-dynamic';

export default async function BulkAddArtistsPage() {
  await requireInternal();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bulk add artists</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Add a whole list of artists at once. <Link href="/artists/new" className="underline">Adding just one?</Link>
        </p>
      </div>
      <BulkAddArtists />
    </div>
  );
}
