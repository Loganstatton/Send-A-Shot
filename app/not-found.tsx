import Link from 'next/link';

export default function ScoutNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-sm max-w-md" style={{ color: 'var(--text-faint)' }}>
        Whatever you were looking for isn't here — it may have moved, or the link was wrong.
      </p>
      <Link href="/" className="btn btn-primary text-sm">Go to dashboard</Link>
    </div>
  );
}
