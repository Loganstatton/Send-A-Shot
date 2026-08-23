import type { Metadata } from 'next';
import Link from 'next/link';
import ArtistForm from '@/components/ArtistForm';
import { requireInternal } from '@/lib/auth';

export const metadata: Metadata = { title: { absolute: 'Add an artist — Scout' } };
export const dynamic = 'force-dynamic';

export default async function NewArtistPage() {
  await requireInternal();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Add an artist</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Add someone you found early to the watchlist and score their breakout potential.{' '}
          <Link href="/artists/bulk-add" className="underline">Adding a whole list at once?</Link>
        </p>
      </div>
      <ArtistForm />
    </div>
  );
}
