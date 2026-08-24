import type { Metadata } from 'next';
import { getPendingArtistClaims } from '@/lib/db';
import { requireInternal } from '@/lib/auth';
import ArtistClaimQueue from '@/components/ArtistClaimQueue';

export const metadata: Metadata = { title: { absolute: 'Artist Claims — Scout' } };
export const dynamic = 'force-dynamic';

export default async function ArtistClaimsPage() {
  await requireInternal();
  const claims = getPendingArtistClaims();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Artist Claims</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Requests from NEXT users claiming to be the artist behind a roster profile. Approve to grant
          them their own Artist Dashboard; reject if it doesn&apos;t check out.
        </p>
      </div>
      <ArtistClaimQueue initial={claims} />
    </div>
  );
}
