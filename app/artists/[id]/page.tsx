import { notFound } from 'next/navigation';
import { getArtist } from '@/lib/db';
import ArtistForm from '@/components/ArtistForm';
import { breakoutScore } from '@/lib/scoring';
import ScoreBadge from '@/components/ScoreBadge';
import ActivityLog from '@/components/ActivityLog';
import ScoreHistory from '@/components/ScoreHistory';

export const dynamic = 'force-dynamic';

export default function ArtistDetailPage({ params }: { params: { id: string } }) {
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
            Added {new Date(artist.created_at).toLocaleDateString()} · Last updated {new Date(artist.updated_at).toLocaleDateString()}
          </p>
        </div>
        <ScoreBadge score={score} size="lg" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ScoreHistory artistId={artist.id} />
        <ActivityLog artistId={artist.id} />
      </div>

      <ArtistForm artist={artist} />
    </div>
  );
}
