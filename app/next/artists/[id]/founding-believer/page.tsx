import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getFoundingBelieverCountForArtist, getFoundingBelieverRecord, getNextArtist } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { foundingBelieverSerial, getFoundingBelieverTier } from '@/lib/founding-believer';
import { heroGradient } from '@/components/next/heroGradient';
import ShareReceiptButton from '@/components/next/ShareReceiptButton';
import ShareToFeedButton from '@/components/next/ShareToFeedButton';
import HoloCard from '@/components/next/HoloCard';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const row = getNextArtist(Number(params.id));
  return { title: row ? `You Were Early — ${row.artist.name}` : 'Founding Believer' };
}

export const dynamic = 'force-dynamic';

// A faint fractal-noise texture — the "archival paper" grain a plain flat
// color card doesn't have. Computed once at module scope (it's a static
// pattern, not per-artist) and reused as a background-image data URI.
const GRAIN_OVERLAY = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>" +
    "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter>" +
    "<rect width='100%' height='100%' filter='url(%23n)'/>" +
    '</svg>'
)}`;

// A permanent, premium "you were early" receipt — never shown as a plain
// list row like the trophy case on Scout Profile. This is the one page
// meant to be screenshotted or downloaded as a card, so it gets its own
// full-bleed treatment instead of reusing next-card's compact style.
//
// Obsidian + tier-accent, not rainbow: a full-spectrum holographic wash
// read as generic "shiny premium" (NFT/gaming-cosmetic energy) rather
// than NEXT's own dark/warm-ember/gold-reserved-for-special-things
// identity — see HoloCard's shine gradient and the .holo-tier-* accent
// tokens in next-theme.css for where that color story actually lives.
function StatComparison({ label, then, now, tone }: { label: string; then: string; now: string; tone: 'up' | 'down' | 'flat' }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4 rounded-xl border" style={{ background: 'oklch(13% 0.01 40 / 0.6)', borderColor: 'var(--border-soft)' }}>
      <span className="text-[11px] font-mono uppercase tracking-[0.1em]" style={{ color: 'var(--text-faint)' }}>{label}</span>
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
  const tier = getFoundingBelieverTier(record.discovery_rank);
  const serial = foundingBelieverSerial(artist.name, record.discovery_rank);
  const lockedDate = new Date(record.purchased_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  // Genesis/Founding (the top 10 backers) is the flex on its own — anyone
  // further back gets the "out of N so far" context instead, same
  // distinction the page always drew, now driven by the tier bands.
  const isTopTen = tier.key === 'genesis' || tier.key === 'founding';

  const heroImageUrl = artist.photo_url || (artist.featured_video_id ? `https://img.youtube.com/vi/${artist.featured_video_id}/hqdefault.jpg` : undefined);

  return (
    <div className="flex flex-col gap-6 max-w-[640px] mx-auto">
      <Link href={`/next/artists/${id}`} className="text-sm inline-flex items-center gap-1.5 w-fit" style={{ color: 'var(--text-faint)' }}>
        ← Back to {artist.name}
      </Link>

      <HoloCard className={`holo-tier-${tier.key}`}>
        <div
          id="founding-believer-receipt"
          className="relative rounded-[28px] border"
          style={{ borderColor: 'var(--tier-accent-line)', background: 'linear-gradient(180deg, oklch(15% 0.012 40) 0%, oklch(9% 0.008 40) 100%)' }}
        >
          <div className="absolute inset-0 pointer-events-none" style={{ opacity: 0.05, mixBlendMode: 'overlay', backgroundImage: `url("${GRAIN_OVERLAY}")`, borderRadius: 'inherit' }} aria-hidden="true" />

          <div className="relative h-[240px] flex items-end p-7" style={{ background: heroImageUrl ? undefined : heroGradient(artist.id) }}>
            {heroImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- Scout-curated/YouTube-thumbnail URL, not a next/image candidate.
              <img src={heroImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
            )}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, oklch(8% 0.01 40 / 0.96) 0%, oklch(8% 0.01 40 / 0.55) 42%, transparent 78%)' }} />
            <div
              className="relative flex items-center gap-2.5 px-3.5 py-2 rounded-full border"
              style={{ borderColor: 'var(--tier-accent-line)', background: 'oklch(9% 0.01 40 / 0.7)', backdropFilter: 'blur(6px)' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--tier-accent)" strokeWidth={2}><path d="M8 21h8M12 17v4M17 5V3H7v2M17 5a5 5 0 0 1-5 5 5 5 0 0 1-5-5M17 5h2a2 2 0 0 1-2 4M7 5H5a2 2 0 0 0 2 4" /></svg>
              <span className="font-display font-bold text-[12px] uppercase tracking-[0.1em]" style={{ color: 'var(--tier-accent)' }}>{tier.label}</span>
            </div>
          </div>

          <div className="relative p-7 flex flex-col gap-6">
            <div>
              <h1 className="font-display font-extrabold text-[30px] m-0 tracking-[-0.01em]">{artist.name}</h1>
              <div className="mt-2 num text-[13px] font-bold uppercase tracking-[0.09em]" style={{ color: 'var(--tier-accent)' }}>
                Backer #{record.discovery_rank}{!isTopTen ? ` of ${currentBackerCount}` : ''} · Locked {lockedDate}
              </div>
            </div>

            <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl border" style={{ borderColor: 'var(--border-soft)', background: 'oklch(13% 0.01 40 / 0.5)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth={2} className="mt-0.5 shrink-0"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              <p className="m-0 text-[13px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                This early-backer record is <strong style={{ color: 'var(--text)' }}>permanent</strong> — it stays attached to your account even if you sell.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

            <div
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 pt-4 border-t num text-[10.5px] uppercase tracking-[0.06em]"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-faint)' }}
            >
              <span>{serial}</span>
              <span>Edition · {tier.edition}</span>
              <span>Issued {lockedDate}</span>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <ShareReceiptButton artistId={id} artistName={artist.name} />
              <ShareToFeedButton artistId={id} />
            </div>
          </div>
        </div>
      </HoloCard>
    </div>
  );
}
