// App Router's built-in loading UI — shown instantly on navigation to
// /next/activity while the Server Component builds the market-wide feed.
export default function ActivityLoading() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="h-9 w-56 rounded" style={{ background: 'var(--surface-2)' }} />
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="next-card flex items-center gap-3 px-5 py-4">
            <div className="w-9 h-9 rounded-full" style={{ background: 'var(--surface-2)' }} />
            <div className="flex-1 h-4 rounded" style={{ background: 'var(--surface-2)' }} />
            <div className="w-20 h-4 rounded" style={{ background: 'var(--surface-2)' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
