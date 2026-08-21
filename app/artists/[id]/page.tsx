import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getArtist } from '@/lib/db';
import { requireInternal } from '@/lib/auth';
import ArtistForm from '@/components/ArtistForm';
import { breakoutScore } from '@/lib/scoring';
import ScoreBadge from '@/components/ScoreBadge';
import ActivityLog from '@/components/ActivityLog';
import ScoreHistory from '@/components/ScoreHistory';
import DealsAndRevenue from '@/components/DealsAndRevenue';
import InvestmentLedger from '@/components/InvestmentLedger';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const artist = getArtist(Number(params.id));
  return { title: { absolute: artist ? `${artist.name} — Scout` : 'Scout' } };
}

export const dynamic = 'force-dynamic';

export default async function ArtistDetailPage({ params }: { params: { id: string } }) {
  await requireInternal();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const artist = getArtist(id);
  if (!artist) notFound();

  const score = breakoutScore(artist);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{artist.name}</h1>
          <p className="text-neutral-400 text-sm">
            Added {new Date(artist.created_at).toLocaleDateString()}
            {artist.created_by_name ? ` by ${artist.created_by_name}` : ''}
            {' · '}Last updated {new Date(artist.updated_at).toLocaleDateString()}
          </p>
        </div>
        <ScoreBadge score={score} size="lg" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ScoreHistory artistId={artist.id} />
        <ActivityLog artistId={artist.id} />
      </div>

      <DealsAndRevenue artistId={artist.id} />

      <InvestmentLedger artistId={artist.id} />

      <ArtistForm artist={artist} />
    </div>
  );
}
