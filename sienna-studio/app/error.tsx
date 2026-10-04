'use client';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-lg">Something went wrong</p>
      <p className="text-sm text-ink-400">{error.message}</p>
      <button onClick={reset} className="min-h-[44px] rounded-xl bg-ink-700 px-4">
        Try again
      </button>
    </div>
  );
}
