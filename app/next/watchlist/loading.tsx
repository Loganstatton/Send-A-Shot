import ArtistCardSkeleton from '@/components/next/ArtistCardSkeleton';

export default function WatchlistLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2 animate-pulse">
        <div className="h-[34px] w-40 rounded" style={{ background: 'var(--surface-2)' }} />
        <div className="h-4 w-72 rounded" style={{ background: 'var(--surface-2)' }} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 3 }).map((_, i) => <ArtistCardSkeleton key={i} />)}
      </div>
    </div>
  );
}
