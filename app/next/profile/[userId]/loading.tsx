// App Router's built-in loading UI — shown instantly on navigation to a
// Scout profile while the Server Component computes rank/discoveries/badges.
export default function ScoutProfileLoading() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full" style={{ background: 'var(--surface-2)' }} />
        <div className="flex flex-col gap-2">
          <div className="h-6 w-40 rounded" style={{ background: 'var(--surface-2)' }} />
          <div className="h-4 w-32 rounded" style={{ background: 'var(--surface-2)' }} />
        </div>
      </div>
      <div
        className="grid grid-cols-2 sm:grid-cols-5 gap-px rounded-2xl overflow-hidden border"
        style={{ background: 'var(--border-soft)', borderColor: 'var(--border-soft)' }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[76px]" style={{ background: 'var(--surface)' }} />
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="next-card h-16" style={{ background: 'var(--surface-2)' }} />
        ))}
      </div>
    </div>
  );
}
