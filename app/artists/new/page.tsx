import type { Metadata } from 'next';
import ArtistForm from '@/components/ArtistForm';
import { requireInternal } from '@/lib/auth';

export const metadata: Metadata = { title: { absolute: 'Add an artist — Scout' } };
export const dynamic = 'force-dynamic';

export default async function NewArtistPage() {
  await requireInternal();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add an artist</h1>
        <p className="text-neutral-400 text-sm">Add someone you found early to the watchlist and score their breakout potential.</p>
      </div>
      <ArtistForm />
    </div>
  );
}
