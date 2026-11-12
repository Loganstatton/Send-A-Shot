import Link from 'next/link';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getWeeklyChallenges, STREAK_MIN } from '@/lib/challenges';

export const metadata: Metadata = { title: 'Weekly challenges' };
export const dynamic = 'force-dynamic';

function resetsIn(endIso: string): string {
  const ms = new Date(endIso).getTime() - Date.now();
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return days > 0 ? `${days}d ${hours}h` : `${Math.max(hours, 0)}h`;
}

const ACTIONS: Record<string, { href: string; label: string }> = {
  early_call: { href: '/next?sort=fewest#artists', label: 'Artists with fewest backers' },
  new_genre: { href: '/next/genres', label: 'Browse genres' },
  scouts_call: { href: '/next?view=scouts-higher#artists', label: 'See who Scouts rate higher' },
  listen: { href: '/next#artists', label: 'Start listening' },
  recruit: { href: '/next/leagues', label: 'Your leagues' },
};

export default async function ChallengesPage() {
  const user = await requireUser();
  const week = await getWeeklyChallenges(user.id);

  return (
    <div className="flex flex-col gap-6 max-w-[780px]">
      <div className="flex flex-col gap-1">
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Weekly challenges</h1>
        <p className="m-0 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Five challenges, new every Monday (UTC). Finish {STREAK_MIN} in a week to keep your streak going. Everything is counted from
          what you do on NEXT; there are no prizes, just bragging rights.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="next-card p-5">
          <p className="m-0 text-xs font-mono uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>This week</p>
          <p className="m-0 num font-bold text-2xl">{week.completedCount} / {week.challenges.length}</p>
        </div>
        <div className="next-card p-5">
          <p className="m-0 text-xs font-mono uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>Streak</p>
          <p className="m-0 num font-bold text-2xl" style={{ color: week.streakWeeks > 0 ? 'var(--ember)' : undefined }}>
            {week.streakWeeks} {week.streakWeeks === 1 ? 'week' : 'weeks'}
          </p>
        </div>
        <div className="next-card p-5">
          <p className="m-0 text-xs font-mono uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>Resets in</p>
          <p className="m-0 num font-bold text-2xl">{resetsIn(week.weekEnd)}</p>
        </div>
      </div>

      <ul className="flex flex-col gap-2.5 list-none p-0 m-0">
        {week.challenges.map((c) => (
          <li key={c.key} className="next-card px-5 py-4 flex items-center gap-4 flex-wrap" style={c.done ? { borderColor: 'var(--up)' } : undefined}>
            <span
              aria-hidden="true"
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
              style={{ background: c.done ? 'var(--up)' : 'var(--surface-2)', color: c.done ? 'var(--bg)' : 'var(--text-faint)', border: '1px solid var(--border-soft)' }}
            >
              {c.done ? '✓' : ''}
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 font-display font-semibold">
                {c.title}
                <span className="sr-only">{c.done ? ' — done' : ' — not done yet'}</span>
              </p>
              <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>{c.description}</p>
              {c.target > 1 && (
                <div className="mt-2 flex items-center gap-2">
                  <div
                    role="progressbar"
                    aria-label={`${c.title} progress`}
                    aria-valuemin={0}
                    aria-valuemax={c.target}
                    aria-valuenow={c.progress}
                    className="h-1.5 flex-1 max-w-[200px] rounded-full overflow-hidden"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <div className="h-full" style={{ width: `${(c.progress / c.target) * 100}%`, background: 'var(--ember)' }} />
                  </div>
                  <span className="num text-xs" style={{ color: 'var(--text-faint)' }}>{c.progress}/{c.target}</span>
                </div>
              )}
            </div>
            {!c.done && (
              <Link href={ACTIONS[c.key].href} className="next-btn-ghost text-xs px-3 py-2 rounded-[9px] shrink-0 inline-block">{ACTIONS[c.key].label}</Link>
            )}
          </li>
        ))}
      </ul>

      <p className="m-0 text-xs" style={{ color: 'var(--text-faint)' }}>
        A backing counts toward the week of your <em>first</em> purchase of that artist. &ldquo;Trust the Scouts&rdquo; uses the Score and
        Price recorded at that moment. &ldquo;Bring a friend&rdquo; counts people who join a league you currently run.
      </p>
    </div>
  );
}
