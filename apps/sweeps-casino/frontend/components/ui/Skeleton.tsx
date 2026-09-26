import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />;
}

export function SkeletonTile() {
  return (
    <div className="w-[37vw] max-w-[140px] shrink-0 sm:w-[180px] sm:max-w-none">
      <Skeleton className="aspect-[3/4] w-full rounded-lg" />
      <Skeleton className="mt-2 h-3 w-3/4" />
      <Skeleton className="mt-1.5 h-2.5 w-1/2" />
    </div>
  );
}

export function SkeletonRow({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonTile key={i} />
      ))}
    </div>
  );
}
