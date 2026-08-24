// App Router's built-in loading UI for the Candidate Queue while it loads.
export default function DiscoveryLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-56 rounded" style={{ background: 'var(--surface-2)' }} />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card h-24" style={{ background: 'var(--surface-2)' }} />
        ))}
      </div>
    </div>
  );
}
