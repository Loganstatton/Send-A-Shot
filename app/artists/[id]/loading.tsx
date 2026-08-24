// App Router's built-in loading UI for the Artist Detail page while it
// loads score history, deals/revenue, activity log, and the edit form.
export default function ArtistDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 rounded" style={{ background: 'var(--surface-2)' }} />
        <div className="h-9 w-16 rounded-full" style={{ background: 'var(--surface-2)' }} />
      </div>
      <div className="card h-32" style={{ background: 'var(--surface-2)' }} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card h-64" style={{ background: 'var(--surface-2)' }} />
        <div className="card h-64" style={{ background: 'var(--surface-2)' }} />
      </div>
      <div className="card h-96" style={{ background: 'var(--surface-2)' }} />
    </div>
  );
}
