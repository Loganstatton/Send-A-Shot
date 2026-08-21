import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Placeholder — the paper-trading market, artist stock pages, and portfolio
// land here next. Exists now so requireInternal()'s redirect for public
// users has somewhere real to go instead of a 404.
export default async function NextHomePage() {
  await requireUser();
  return (
    <div className="card text-center py-16 space-y-2">
      <h1 className="text-2xl font-semibold">NEXT is coming soon</h1>
      <p className="text-neutral-400">Discover artists before they blow up, and paper-trade your picks. Under construction.</p>
    </div>
  );
}
