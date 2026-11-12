import Link from 'next/link';
import type { WeeklyChallenges } from '@/lib/challenges';

// Compact "this week" strip for Discover. Server component.
export default function ChallengesCard({ week }: { week: WeeklyChallenges }) {
  const next = week.challenges.find((c) => !c.done);
  return (
    <Link href="/next/challenges" className="next-card next-card-hover px-5 py-4 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {week.challenges.map((c) => (
          <span key={c.key} className="w-2.5 h-2.5 rounded-full" style={{ background: c.done ? 'var(--up)' : 'var(--border)' }} />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm font-semibold">
          Weekly challenges: {week.completedCount} of {week.challenges.length} done
          {week.streakWeeks > 0 && <span style={{ color: 'var(--ember)' }}> · {week.streakWeeks}-week streak</span>}
        </p>
        <p className="m-0 text-xs truncate" style={{ color: 'var(--text-faint)' }}>
          {next ? `Next up: ${next.title} — ${next.description}` : 'All done this week. New challenges on Monday.'}
        </p>
      </div>
      <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>→</span>
    </Link>
  );
}
