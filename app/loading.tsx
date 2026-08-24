// App Router's built-in loading UI for the Scout dashboard (app/page.tsx)
// while it computes today's follow-ups, discovery counts, and roster stats.
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-64 rounded" style={{ background: 'var(--surface-2)' }} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-24" style={{ background: 'var(--surface-2)' }} />
        ))}
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card h-16" style={{ background: 'var(--surface-2)' }} />
        ))}
      </div>
    </div>
  );
}
