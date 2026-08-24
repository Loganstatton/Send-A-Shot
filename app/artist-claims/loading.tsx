// App Router's built-in loading UI for the pending-claims review queue.
export default function ArtistClaimsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-56 rounded" style={{ background: 'var(--surface-2)' }} />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-20" style={{ background: 'var(--surface-2)' }} />
        ))}
      </div>
    </div>
  );
}
