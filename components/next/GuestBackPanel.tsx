import Link from 'next/link';
import { formatCents } from '@/lib/format';
import { NEXT_STARTING_CREDITS_CENTS } from '@/lib/next-market';

// Stands in for the trade panel when nobody is signed in: same place on the
// page (and the same #trade-panel anchor the mobile "Back" bar scrolls to),
// but instead of a form that would be refused, a plain explanation of what
// backing is and a way in that returns here afterwards.
export default function GuestBackPanel({ artistId, artistName, priceCents }: { artistId: number; artistName: string; priceCents: number }) {
  const next = encodeURIComponent(`/next/artists/${artistId}`);
  return (
    <div id="trade-panel" className="next-card p-[22px] flex flex-col gap-4 sticky top-6 h-fit">
      <div>
        <div className="text-xs uppercase tracking-[0.06em] font-mono mb-1.5" style={{ color: 'var(--text-faint)' }}>NEXT Price</div>
        <div className="num text-[28px] font-bold">{formatCents(priceCents)}</div>
      </div>
      <p className="m-0 text-[14px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Think {artistName} is going places? Create a free account to back them with virtual credits — you start with{' '}
        <strong style={{ color: 'var(--text)' }}>{formatCents(NEXT_STARTING_CREDITS_CENTS)}</strong>. Your first backing is
        stamped with your backer number and the date, permanently.
      </p>
      <Link href={`/signup?next=${next}`} className="next-btn-primary text-center py-3 rounded-[10px] text-[14.5px] font-bold">
        Sign up to back {artistName}
      </Link>
      <p className="m-0 text-[13px] text-center" style={{ color: 'var(--text-faint)' }}>
        Already have an account? <Link href={`/login?next=${next}`} className="underline">Log in</Link>
      </p>
      <p className="m-0 text-[11.5px] leading-snug" style={{ color: 'var(--text-faint)' }}>
        Credits are virtual and can&apos;t be bought or cashed out. Backing an artist doesn&apos;t give you any ownership of their music or earnings.
      </p>
    </div>
  );
}
