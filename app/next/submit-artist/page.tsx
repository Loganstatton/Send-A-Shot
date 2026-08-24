import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import SubmitArtistForm from '@/components/next/SubmitArtistForm';

export const metadata: Metadata = { title: 'Submit an artist' };
export const dynamic = 'force-dynamic';

export default async function SubmitArtistPage() {
  await requireUser();

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-5">
      <div>
        <h1 className="font-display font-bold text-2xl m-0">Submit an artist</h1>
        <p className="mt-2 mb-0 text-sm leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          Found someone before we did? Tell us who — a Scout reviews every submission the same
          way they review artists our own discovery tools flag.
        </p>
      </div>
      <SubmitArtistForm />
    </div>
  );
}
