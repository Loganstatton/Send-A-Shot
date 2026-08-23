import { RecentTrade } from '@/lib/db';
import { formatCents, timeAgo } from '@/lib/format';

// Everyone's trades on this one artist, most recent first — see
// getRecentTradesForArtist in lib/db.ts for why this is public (same
// convention the Leaderboard already uses).
export default function RecentActivity({ trades }: { trades: RecentTrade[] }) {
  if (trades.length === 0) {
    return (
      <div className="next-card p-6">
        <h2 className="font-display font-bold text-[17px] m-0 mb-2">Recent activity</h2>
        <p className="m-0 text-[13px]" style={{ color: 'var(--text-faint)' }}>No trades yet — be the first to back this artist.</p>
      </div>
    );
  }

  return (
    <div className="next-card p-6">
      <h2 className="font-display font-bold text-[17px] m-0 mb-4">Recent activity</h2>
      <div className="flex flex-col gap-1">
        {trades.map((t, i) => (
          <div key={i} className="flex items-center justify-between py-2 text-[13px]" style={{ borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined }}>
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="px-2 py-[3px] rounded-full text-[11px] font-semibold shrink-0"
                style={t.type === 'buy' ? { background: 'var(--ember-dim)', color: 'var(--ember)' } : { background: 'var(--down-dim)', color: 'var(--down)' }}
              >
                {t.type === 'buy' ? 'Bought' : 'Sold'}
              </span>
              <span className="truncate" style={{ color: 'var(--text-muted)' }}>{t.user_name}</span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="num" style={{ color: 'var(--text)' }}>{formatCents(Math.abs(t.credits_delta_cents))}</span>
              <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>{timeAgo(t.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
