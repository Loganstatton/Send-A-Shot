import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireArtistOwner } from '@/lib/auth';
import { getBackerCountsByArtist, getFoundingBelieverCountForArtist, getNextArtist, getScoreHistory, getWatchCountsByArtist } from '@/lib/db';
import { scoreContributors } from '@/lib/scoring';
import { formatCents } from '@/lib/format';
import PriceChart from '@/components/PriceChart';
import ScoreContributorBar from '@/components/next/ScoreContributorBar';
import ArtistDashboardNoteForm from '@/components/next/ArtistDashboardNoteForm';
import ArtistProfileEditForm from '@/components/next/ArtistProfileEditForm';
import ArtistPhotoSubmitForm from '@/components/next/ArtistPhotoSubmitForm';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const id = Number(params.id);
  const row = Number.isInteger(id) ? getNextArtist(id) : undefined;
  return { title: row ? `${row.artist.name} — My Artist` : 'My Artist' };
}

export const dynamic = 'force-dynamic';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="next-card p-4">
      <div className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="num text-lg font-bold">{value}</div>
    </div>
  );
}

// Stats/score/price history are read-only — the same public-safe data any
// NEXT trader already sees on the artist's own page (app/next/artists/[id]),
// just framed for the artist. Pre-beta migration: the profile fields below
// (bio, genre, location, links, photo) ARE now artist-editable — see
// CLAIMED_ARTIST_EDITABLE_FIELDS/setArtistPhotoByOwner in lib/db.ts for the
// exact whitelist. Everything outside that whitelist (name, stage, Scout
// notes, the Breakout Score inputs, internal discovery info) stays
// Scout-only; an artist wanting a change there sends it via
// ArtistDashboardNoteForm below instead.
export default async function MyArtistDashboardPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const { artist } = await requireArtistOwner(id);

  const row = getNextArtist(id);
  if (!row) notFound();
  const { score, priceCents, priceHistory } = row;
  const scoreHistory = getScoreHistory(id);
  const scoreParts = scoreContributors(artist);
  const backerCount = getBackerCountsByArtist()[id] ?? 0;
  const earlyBackerCount = getFoundingBelieverCountForArtist(id);
  const watchCount = getWatchCountsByArtist()[id] ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-[0.06em] font-mono m-0" style={{ color: 'var(--text-faint)' }}>Artist Dashboard</p>
        <h1 className="font-display font-bold text-[28px] m-0">{artist.name}</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="NEXT Score" value={score.toFixed(0)} />
        <Stat label="NEXT Price" value={formatCents(priceCents)} />
        <Stat label="Backers" value={backerCount.toLocaleString()} />
        <Stat label="Watching" value={watchCount.toLocaleString()} />
      </div>

      <div className="next-card p-6">
        <div className="text-xs uppercase tracking-[0.06em] font-mono mb-1.5" style={{ color: 'var(--text-faint)' }}>NEXT Price</div>
        <PriceChart points={priceHistory.map((p) => ({ recorded_at: p.recorded_at, value: p.price_cents }))} format="cents" />
      </div>

      <div className="next-card p-6">
        <div className="text-xs uppercase tracking-[0.06em] font-mono mb-1.5" style={{ color: 'var(--text-faint)' }}>NEXT Score</div>
        <PriceChart
          points={scoreHistory.map((s) => ({ recorded_at: s.recorded_at, value: s.breakout_score }))}
          format="number"
          color="var(--ember)"
        />
        <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--border-soft)' }}>
          <div className="text-xs uppercase tracking-[0.06em] font-mono mb-3" style={{ color: 'var(--text-faint)' }}>Why the Score is what it is</div>
          <div className="flex flex-col gap-2.5">
            <ScoreContributorBar label="Growth &amp; engagement" points={scoreParts.realDataPoints} total={scoreParts.total} color="var(--up)" />
            <ScoreContributorBar label="Everything else" points={scoreParts.scoutPoints} total={scoreParts.total} color="var(--ember)" />
          </div>
        </div>
      </div>

      {earlyBackerCount > 0 && (
        <p className="m-0 text-sm" style={{ color: 'var(--text-faint)' }}>
          {earlyBackerCount} Scout{earlyBackerCount === 1 ? '' : 's'} backed you before anyone else did.
        </p>
      )}

      <ArtistPhotoSubmitForm artistId={id} currentPhotoUrl={artist.photo_url} />

      <ArtistProfileEditForm
        artistId={id}
        initial={{
          bio: artist.bio, genre: artist.genre, location: artist.location, website_url: artist.website_url,
          tiktok_url: artist.tiktok_url, instagram_url: artist.instagram_url, youtube_url: artist.youtube_url,
          spotify_url: artist.spotify_url, soundcloud_url: artist.soundcloud_url, featured_video_id: artist.featured_video_id,
        }}
      />

      <ArtistDashboardNoteForm artistId={id} />
    </div>
  );
}
