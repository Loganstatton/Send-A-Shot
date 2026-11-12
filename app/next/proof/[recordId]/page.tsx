import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFoundingBelieverCountForArtist, getFoundingBelieverRecordById, getNextArtist, getUserById, logEvent } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { foundingBelieverSerial, getFoundingBelieverTier } from '@/lib/founding-believer';
import { getArtistAvatarUrl } from '@/lib/artist-image';
import { heroGradient } from '@/components/next/heroGradient';
import HoloCard from '@/components/next/HoloCard';
import CopyProofLinkButton from '@/components/next/CopyProofLinkButton';

export const dynamic = 'force-dynamic';

async function load(recordIdParam: string) {
  const recordId = Number(recordIdParam);
  if (!Number.isInteger(recordId)) return null;
  const record = await getFoundingBelieverRecordById(recordId);
  if (!record) return null;
  const [row, holder] = await Promise.all([getNextArtist(record.artist_id), getUserById(record.user_id)]);
  if (!row || !holder) return null;
  return { record, row, holder };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export async function generateMetadata(props: { params: Promise<{ recordId: string }> }): Promise<Metadata> {
  const params = await props.params;
  const data = await load(params.recordId);
  if (!data) return { title: 'Early proof' };
  const { record, row, holder } = data;
  const title = `${holder.name} was backer #${record.discovery_rank} of ${row.artist.name}`;
  const description = `Recorded on NEXT on ${formatDate(record.purchased_at)}. Discover tomorrow's biggest artists — and prove you found them first.`;
  const image = `/api/next/proof/${record.id}/card`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'article', images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

function Comparison({ label, then, now, tone }: { label: string; then: string; now: string; tone: 'up' | 'down' | 'flat' }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4 rounded-xl border" style={{ background: 'oklch(13% 0.01 40 / 0.6)', borderColor: 'var(--border-soft)' }}>
      <span className="text-[11px] font-mono uppercase tracking-[0.1em]" style={{ color: 'var(--text-faint)' }}>{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="num text-sm" style={{ color: 'var(--text-faint)' }}>{then}</span>
        <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>→</span>
        <span className="sr-only">then, now</span>
        <span className="num text-lg font-bold" style={{ color: tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--text)' }}>{now}</span>
      </div>
    </div>
  );
}

// The shareable, public "I was early" page for ONE Founding Believer record.
// Anyone with the link can open it, signed in or not — it's what the owner
// sends to friends or posts, and its preview image is the card itself.
// Everything on it was written at the moment of the first backing and is
// never edited afterwards (next_founding_believers rows are insert-only),
// which is what makes it proof rather than a claim.
export default async function EarlyProofPage(props: { params: Promise<{ recordId: string }> }) {
  const params = await props.params;
  const data = await load(params.recordId);
  if (!data) notFound();
  const { record, row, holder } = data;
  const viewer = await getSessionUser();
  const isOwner = viewer?.id === record.user_id;
  await logEvent(viewer?.id ?? null, 'artist_detail_opened', { artistId: record.artist_id, proofRecordId: record.id, via: 'proof_page' });

  const { artist, score, priceCents } = row;
  const backersNow = await getFoundingBelieverCountForArtist(record.artist_id);
  const tier = getFoundingBelieverTier(record.discovery_rank);
  const serial = foundingBelieverSerial(artist.name, record.discovery_rank);
  const heroImageUrl = getArtistAvatarUrl(artist);
  const tone = (now: number, then: number) => (now > then ? 'up' : now < then ? 'down' : 'flat') as 'up' | 'down' | 'flat';

  return (
    <div className="flex flex-col gap-6 max-w-[640px] mx-auto">
      <HoloCard className={`holo-tier-${tier.key}`}>
        <div className="relative rounded-[28px] border overflow-hidden" style={{ borderColor: 'var(--tier-accent-line)', background: 'linear-gradient(180deg, oklch(15% 0.012 40) 0%, oklch(9% 0.008 40) 100%)' }}>
          <div className="relative h-[200px] flex items-end p-7" style={{ background: heroImageUrl ? undefined : heroGradient(artist.id) }}>
            {heroImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- Scout-curated URL, not a next/image candidate.
              <img src={heroImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
            )}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, oklch(8% 0.01 40 / 0.96) 0%, oklch(8% 0.01 40 / 0.55) 42%, transparent 78%)' }} />
            <span className="relative px-3.5 py-2 rounded-full border font-display font-bold text-[12px] uppercase tracking-[0.1em]" style={{ borderColor: 'var(--tier-accent-line)', background: 'oklch(9% 0.01 40 / 0.7)', color: 'var(--tier-accent)' }}>
              {tier.label}
            </span>
          </div>

          <div className="relative p-7 flex flex-col gap-6">
            <div>
              <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
                <Link href={`/next/profile/${holder.id}`} className="font-semibold underline-offset-2 hover:underline" style={{ color: 'var(--text)' }}>{holder.name}</Link>{' '}
                was backer
              </p>
              <h1 className="font-display font-extrabold text-[30px] m-0 mt-1 tracking-[-0.01em]">
                <span style={{ color: 'var(--tier-accent)' }}>#{record.discovery_rank}</span> of {artist.name}
              </h1>
              <p className="mt-2 mb-0 num text-[13px]" style={{ color: 'var(--text-faint)' }}>
                {formatDate(record.purchased_at)} · {backersNow} {backersNow === 1 ? 'backer' : 'backers'} so far
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Comparison label="NEXT Score" then={record.next_score.toFixed(0)} now={score.toFixed(0)} tone={tone(score, record.next_score)} />
              <Comparison label="NEXT Price" then={formatCents(record.next_price_cents)} now={formatCents(priceCents)} tone={tone(priceCents, record.next_price_cents)} />
            </div>

            <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
              Recorded by NEXT at the moment of backing and never edited afterwards — the backer number, date and
              starting Score and Price can&apos;t be changed or backdated, including by {holder.name}. NEXT Score is
              our Scouts&apos; rating; NEXT Price comes from a game played with virtual credits.
            </p>

            <div className="flex items-center justify-between gap-3 pt-4 border-t num text-[10.5px] uppercase tracking-[0.06em]" style={{ borderColor: 'var(--border-soft)', color: 'var(--text-faint)' }}>
              <span>{serial}</span>
              <span>Edition · {tier.edition}</span>
            </div>
          </div>
        </div>
      </HoloCard>

      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/next/artists/${artist.id}`} className="next-btn-ghost text-sm px-4 py-2.5 rounded-[10px]">Listen to {artist.name}</Link>
        {isOwner && <CopyProofLinkButton recordId={record.id} artistName={artist.name} />}
      </div>

      {!viewer && (
        <div className="next-card p-6 flex flex-col gap-3">
          <p className="m-0 font-display font-bold text-lg">Think you can spot the next one first?</p>
          <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
            NEXT is a free game for finding emerging artists early. Back the ones you believe in with virtual credits and get your own permanent proof.
          </p>
          <Link href={`/signup?next=${encodeURIComponent(`/next/artists/${artist.id}`)}`} className="next-btn-primary w-fit px-5 py-2.5 rounded-[10px] text-sm font-semibold">
            Start scouting — it&apos;s free
          </Link>
        </div>
      )}
    </div>
  );
}
