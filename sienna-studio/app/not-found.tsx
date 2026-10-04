import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3">
      <p className="text-lg">Not found</p>
      <Link href="/" className="text-accent">
        Back to Create
      </Link>
    </div>
  );
}
