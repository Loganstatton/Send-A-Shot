// App Router's built-in loading UI — shown instantly on navigation to
// /next/leaderboard while the Server Component computes rankings.
export default function LeaderboardLoading() {
  return (
    <div className="flex flex-col gap-8 animate-pulse">
      <div className="flex flex-col gap-2">
        <div className="h-9 w-56 rounded" style={{ background: 'var(--surface-2)' }} />
        <div className="h-4 w-72 rounded" style={{ background: 'var(--surface-2)' }} />
      </div>
      <div className="flex gap-2.5 flex-wrap">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-full" style={{ background: 'var(--surface-2)' }} />
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="next-card flex items-center gap-3 px-5 py-4">
            <div className="w-8 h-4 rounded" style={{ background: 'var(--surface-2)' }} />
            <div className="w-10 h-10 rounded-full" style={{ background: 'var(--surface-2)' }} />
            <div className="flex-1 h-4 rounded" style={{ background: 'var(--surface-2)' }} />
            <div className="w-16 h-4 rounded" style={{ background: 'var(--surface-2)' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
