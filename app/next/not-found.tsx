import Link from 'next/link';

export default function NextNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="font-display font-bold text-2xl m-0">Page not found</h1>
      <p className="text-sm max-w-md m-0" style={{ color: 'var(--text-faint)' }}>
        Whatever you were looking for isn't here — the artist may have moved, or the link was wrong.
      </p>
      <Link href="/next" className="next-btn-primary text-sm px-5 py-2.5 rounded-lg">Back to Discover</Link>
    </div>
  );
}
