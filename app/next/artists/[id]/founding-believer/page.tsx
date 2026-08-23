import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFoundingBelieverCountForArtist, getFoundingBelieverRecord, getNextArtist } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { EARLY_DISCOVERY_RANK_THRESHOLD } from '@/lib/scout-score';
import { heroGradient } from '@/components/next/heroGradient';
import ShareReceiptButton from '@/components/next/ShareReceiptButton';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const row = getNextArtist(Number(params.id));
  return { title: row ? `You Were Early — ${row.artist.name}` : 'Founding Believer' };
}

export const dynamic = 'force-dynamic';

// A permanent, premium "you were early" receipt — never shown as a plain
// list row like the trophy case on Scout Profile. This is the one page
// meant to be screenshotted or downloaded as a card, so it gets its own
// full-bleed treatment instead of reusing next-card's compact style.
function StatComparison({ label, then, now, tone }: { label: string; then: string; now: string; tone: 'up' | 'down' | 'flat' }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4 rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border-soft)' }}>
      <span className="text-[11px] font-mono uppercase tracking-[0.06em]" style={{ color: 'var(--text-faint)' }}>{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="num text-sm" style={{ color: 'var(--text-faint)' }}>{then}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth={2.5}><path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="num text-lg font-bold" style={{ color: tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--text)' }}>{now}</span>
      </div>
    </div>
  );
}

export default async function FoundingBelieverReceiptPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const row = getNextArtist(id);
  if (!row) notFound();
  const record = getFoundingBelieverRecord(user.id, id);
  if (!record) notFound();

  const { artist, score, priceCents } = row;
  const currentBackerCount = getFoundingBelieverCountForArtist(id);
  const wasEarly = record.discovery_rank <= EARLY_DISCOVERY_RANK_THRESHOLD;

  const heroImageUrl = artist.photo_url || (artist.featured_video_id ? `https://img.youtube.com/vi/${artist.featured_video_id}/hqdefault.jpg` : undefined);

  return (
    <div className="flex flex-col gap-6 max-w-[640px] mx-auto">
      <Link href={`/next/artists/${id}`} className="text-sm inline-flex items-center gap-1.5 w-fit" style={{ color: 'var(--text-faint)' }}>
        ← Back to {artist.name}
      </Link>

      <div
        id="founding-believer-receipt"
        className="relative rounded-[28px] overflow-hidden border"
        style={{ borderColor: 'var(--gold-line)', background: 'var(--surface)' }}
      >
        <div className="relative h-[220px] flex items-end p-7" style={{ background: heroImageUrl ? undefined : heroGradient(artist.id) }}>
          {heroImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- Scout-curated/YouTube-thumbnail URL, not a next/image candidate.
            <img src={heroImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, oklch(12% 0.01 40 / 0.92), transparent 65%)' }} />
          <div className="relative flex items-center gap-2.5">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={2}><path d="M8 21h8M12 17v4M17 5V3H7v2M17 5a5 5 0 0 1-5 5 5 5 0 0 1-5-5M17 5h2a2 2 0 0 1-2 4M7 5H5a2 2 0 0 0 2 4" /></svg>
            <span className="font-display font-bold text-[13px] uppercase tracking-[0.08em]" style={{ color: 'var(--gold)' }}>Founding Believer</span>
          </div>
        </div>

        <div className="p-7 flex flex-col gap-6">
          <div>
            <h1 className="font-display font-extrabold text-[28px] m-0 tracking-[-0.01em]">{artist.name}</h1>
            <p className="mt-1.5 mb-0 text-sm" style={{ color: 'var(--text-muted)' }}>
              You backed this artist on {new Date(record.purchased_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.
              You were backer <strong style={{ color: 'var(--gold)' }}>#{record.discovery_rank}</strong>
              {wasEarly ? ' — early enough to count.' : `, out of ${currentBackerCount} today.`}
              {' '}This record never changes, even if you sell.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatComparison
              label="Followers"
              then={record.followers_count != null ? record.followers_count.toLocaleString() : '—'}
              now={artist.followers_count != null ? artist.followers_count.toLocaleString() : '—'}
              tone={artist.followers_count != null && record.followers_count != null ? (artist.followers_count >= record.followers_count ? 'up' : 'down') : 'flat'}
            />
            <StatComparison
              label="NEXT Score"
              then={record.next_score.toFixed(0)}
              now={score.toFixed(0)}
              tone={score >= record.next_score ? 'up' : 'down'}
            />
            <StatComparison
              label="NEXT Price"
              then={formatCents(record.next_price_cents)}
              now={formatCents(priceCents)}
              tone={priceCents >= record.next_price_cents ? 'up' : 'down'}
            />
          </div>

          <ShareReceiptButton artistId={id} artistName={artist.name} />
        </div>
      </div>
    </div>
  );
}
