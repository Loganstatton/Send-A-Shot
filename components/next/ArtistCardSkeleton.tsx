// Matches ArtistCard's exact box sizes (200px hero, same padding/gaps) so
// the swap from loading → real content never causes layout shift.
export default function ArtistCardSkeleton() {
  return (
    <div className="next-card relative flex flex-col overflow-hidden animate-pulse">
      <div className="h-[200px]" style={{ background: 'var(--surface-2)' }} />
      <div className="px-5 pt-[18px] pb-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex flex-col gap-2 flex-1">
            <div className="h-[19px] w-2/3 rounded" style={{ background: 'var(--surface-2)' }} />
            <div className="h-3 w-1/3 rounded" style={{ background: 'var(--surface-2)' }} />
          </div>
          <div className="h-[17px] w-14 rounded" style={{ background: 'var(--surface-2)' }} />
        </div>
        <div className="h-6 w-24 rounded-lg" style={{ background: 'var(--surface-2)' }} />
        <div className="h-9 rounded-[10px]" style={{ background: 'var(--surface-2)' }} />
      </div>
      <div className="px-5 pb-5">
        <div className="h-9 rounded-[10px]" style={{ background: 'var(--surface-2)' }} />
      </div>
    </div>
  );
}
