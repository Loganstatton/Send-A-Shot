import ArtistCardSkeleton from '@/components/next/ArtistCardSkeleton';

// App Router's built-in loading UI — shown instantly on navigation to
// /next while the Server Component fetches the market. The title/subtitle
// and stat-tile shape below match the real page exactly so nothing shifts
// when the real content swaps in.
export default function DiscoverLoading() {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-5 max-w-[720px]">
        <h1 className="font-display font-bold text-[32px] sm:text-[40px] lg:text-[46px] leading-[1.08] lg:leading-[1.05] tracking-[-0.015em] m-0" style={{ textWrap: 'balance' } as React.CSSProperties}>
          Discover tomorrow&apos;s biggest artists. <span style={{ color: 'var(--ember)' }}>Prove you found them first.</span>
        </h1>
        <p className="text-base leading-relaxed m-0 max-w-[60ch]" style={{ color: 'var(--text-muted)' }}>
          Listen to emerging musicians our Scouts are tracking, back the ones you believe in with free virtual
          credits, and get a permanent, dated record that you were early.
        </p>
      </div>

      <div className="next-card h-[220px] md:h-[320px] animate-pulse" style={{ background: 'var(--surface-2)' }} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => <ArtistCardSkeleton key={i} />)}
      </div>
    </div>
  );
}
