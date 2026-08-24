// App Router's built-in loading UI — shown instantly on navigation to
// /next/portfolio while the Server Component reconstructs value history.
export default function PortfolioLoading() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="h-9 w-48 rounded" style={{ background: 'var(--surface-2)' }} />
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-2xl overflow-hidden border"
        style={{ background: 'var(--border-soft)', borderColor: 'var(--border-soft)' }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[76px]" style={{ background: 'var(--surface)' }} />
        ))}
      </div>
      <div className="next-card h-[240px]" style={{ background: 'var(--surface-2)' }} />
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="next-card flex items-center gap-3 px-5 py-4">
            <div className="w-10 h-10 rounded-full" style={{ background: 'var(--surface-2)' }} />
            <div className="flex-1 h-4 rounded" style={{ background: 'var(--surface-2)' }} />
            <div className="w-20 h-4 rounded" style={{ background: 'var(--surface-2)' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
