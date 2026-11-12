import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireArtistOwner } from '@/lib/auth';
import { getBackerCountsByArtist, getFoundingBelieverCountForArtist, getNextArtist, getPublicScoreChanges, getScoreHistory, getWatchCountsByArtist } from '@/lib/db';
import { formatCents } from '@/lib/format';
import PriceChart from '@/components/PriceChart';
import ScoreExplainer from '@/components/next/ScoreExplainer';
import ArtistDashboardNoteForm from '@/components/next/ArtistDashboardNoteForm';
import ArtistProfileEditForm from '@/components/next/ArtistProfileEditForm';
import ArtistPhotoSubmitForm from '@/components/next/ArtistPhotoSubmitForm';

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const id = Number(params.id);
  const row = Number.isInteger(id) ? await getNextArtist(id) : undefined;
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
export default async function MyArtistDashboardPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const { artist } = await requireArtistOwner(id);

  const row = await getNextArtist(id);
  if (!row) notFound();
  const { score, priceCents, priceHistory } = row;
  const scoreHistory = await getScoreHistory(id);
  const scoreChanges = await getPublicScoreChanges(artist.id);
  const backerCount = (await getBackerCountsByArtist())[id] ?? 0;
  const earlyBackerCount = await getFoundingBelieverCountForArtist(id);
  const watchCount = (await getWatchCountsByArtist())[id] ?? 0;

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
          <ScoreExplainer ratings={artist} rationale={artist.score_rationale} scoredAt={artist.scored_at} changes={scoreChanges} />
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
