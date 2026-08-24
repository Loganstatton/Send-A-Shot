// App Router's built-in loading UI for the portfolio/ROI screener while it
// computes returns across every artist under an active deal.
export default function ScreenerLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-56 rounded" style={{ background: 'var(--surface-2)' }} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-24" style={{ background: 'var(--surface-2)' }} />
        ))}
      </div>
      <div className="card h-96" style={{ background: 'var(--surface-2)' }} />
    </div>
  );
}
