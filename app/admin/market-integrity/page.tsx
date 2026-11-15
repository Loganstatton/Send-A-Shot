import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { getRoundingExploitAudit, getSuspiciousTradingFlags } from '@/lib/db';
import { formatCents } from '@/lib/format';
import { COORDINATED_PAIR_WINDOW_MINUTES, RAPID_TRADE_WINDOW_MINUTES } from '@/lib/market-integrity';
import AdminTabs from '@/components/AdminTabs';

export const metadata: Metadata = { title: { absolute: 'Market integrity — Scout' } };
export const dynamic = 'force-dynamic';

const KIND_LABELS = {
  rapid_trading: 'Rapid trading',
  coordinated_pair: 'Coordinated pair',
} as const;

export default async function AdminMarketIntegrityPage() {
  await requireAdmin();
  const flags = await getSuspiciousTradingFlags();
  const audit = await getRoundingExploitAudit();

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Market integrity</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Behavioral flags computed fresh from trade history every time this page loads — one account
          firing many trades on the same artist in a short window ({RAPID_TRADE_WINDOW_MINUTES} min), or
          two different accounts trading the same artist back and forth ({COORDINATED_PAIR_WINDOW_MINUTES} min).
          A flag is a reason to look, not a verdict — a real friendship trading the same favorite artist can
          look similar to two colluding accounts. Nothing here auto-suppresses anyone from the market or the
          leaderboard; that decision stays a human's.
        </p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Flags ({flags.length})</h2>
        {flags.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nothing flagged right now.</p>
        ) : (
          <div className="space-y-2">
            {flags.map((f, i) => (
              <div key={i} className="rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ border: '1px solid var(--fire-line)', background: 'var(--fire-dim)' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="badge text-xs" style={{ color: 'var(--fire)' }}>{KIND_LABELS[f.kind]}</span>
                    {f.artistName && (
                      <Link href={`/artists/${f.artistId}`} className="underline font-medium text-sm">{f.artistName}</Link>
                    )}
                  </div>
                  <p className="text-sm mt-1 mb-0" style={{ color: 'var(--text-muted)' }}>{f.detail}</p>
                  <p className="text-xs mt-1 mb-0" style={{ color: 'var(--text-faint)' }}>
                    {f.userIds.map((userId, idx) => (
                      <span key={userId}>
                        {idx > 0 && ' · '}
                        <Link href={`/next/profile/${userId}`} className="underline">{f.userNames?.[idx] ?? `User #${userId}`}</Link>
                      </span>
                    ))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Rounding-exploit audit (fixed 15 Nov 2026)</h2>
        <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>
          Before the exact-fill fix, one player could gain Credits with nobody else trading by buying in one block and
          selling back in small slices (or the reverse). Done normally, a round trip with no other player trading that
          artist in between always lost a little, so an isolated round trip that <strong>made</strong> Credits is the
          evidence. Read-only: no balance is changed here.
        </p>
        <p className="text-sm m-0">
          {audit.tradesChecked} trades by {audit.accountsThatTraded} accounts · {audit.roundTripsFound} round trips ·{' '}
          {audit.isolatedRoundTrips} isolated · <strong>{audit.profitableIsolatedRoundTrips.length} profitable isolated</strong>
          {audit.profitableIsolatedRoundTrips.length > 0 && <> ({formatCents(audit.profitFromThoseCents)} in total)</>} ·{' '}
          {audit.slicingPatternRoundTrips.length} with the slicing pattern
        </p>
        {[...audit.profitableIsolatedRoundTrips, ...audit.slicingPatternRoundTrips.filter((e) => !(e.isolated && e.profitCents > 0))].map((e, i) => (
          <p key={i} className="text-sm m-0" style={{ color: 'var(--text-faint)' }}>
            <Link href={`/next/profile/${e.userId}`} className="underline">User #{e.userId}</Link> on{' '}
            <Link href={`/artists/${e.artistId}`} className="underline">artist #{e.artistId}</Link>: {e.buys} buys, {e.sells} sells,{' '}
            {e.profitCents >= 0 ? '+' : ''}{formatCents(e.profitCents)}{e.isolated ? ' · isolated' : ''}{e.slicingPattern ? ' · slicing pattern' : ''}
          </p>
        ))}
      </div>
    </div>
  );
}
