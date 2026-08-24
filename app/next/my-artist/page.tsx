import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getArtistsClaimedByUser } from '@/lib/db';

export const metadata: Metadata = { title: 'My Artist' };
export const dynamic = 'force-dynamic';

// The entry point behind the nav's "My Artist" link — one claimed artist
// goes straight to its dashboard, more than one shows a picker, and zero
// (shouldn't normally be reachable, since the link only appears once
// hasClaimedArtist is true, but a stale claim revoked mid-session could
// land here) explains how to get one.
export default async function MyArtistEntryPage() {
  const user = await requireUser();
  const claimed = getArtistsClaimedByUser(user.id);

  if (claimed.length === 1) redirect(`/next/my-artist/${claimed[0].id}`);

  if (claimed.length === 0) {
    return (
      <div className="max-w-lg mx-auto flex flex-col items-center gap-4 py-14 text-center">
        <h1 className="font-display font-bold text-2xl m-0">No claimed artist yet</h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          If you&apos;re the artist behind a profile on NEXT, open that artist&apos;s page and claim it.
          Once a Scout verifies you, your dashboard shows up here.
        </p>
        <Link href="/next" className="next-btn-primary text-sm px-4 py-2.5 rounded-lg">Browse artists</Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-4">
      <h1 className="font-display font-bold text-2xl m-0">Your artists</h1>
      <div className="flex flex-col gap-3">
        {claimed.map((a) => (
          <Link key={a.id} href={`/next/my-artist/${a.id}`} className="next-card next-card-hover p-5 flex items-center justify-between">
            <span className="font-semibold">{a.name}</span>
            <span style={{ color: 'var(--text-faint)' }}>→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
