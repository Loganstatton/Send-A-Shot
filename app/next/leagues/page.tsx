import Link from 'next/link';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getLeaguesForUser, LEAGUE_MAX_MEMBERS } from '@/lib/leagues';
import { CreateLeagueForm, JoinLeagueForm } from '@/components/next/LeagueControls';

export const metadata: Metadata = { title: 'Leagues' };
export const dynamic = 'force-dynamic';

export default async function LeaguesPage() {
  const user = await requireUser();
  const leagues = await getLeaguesForUser(user.id);

  return (
    <div className="flex flex-col gap-8 max-w-[780px]">
      <div>
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Leagues</h1>
        <p className="mt-1 mb-0 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Private competitions with your friends, up to {LEAGUE_MAX_MEMBERS} people each. Everyone is ranked by how their
          portfolio has done since the day they joined, so it&apos;s fair to people who join late.
        </p>
      </div>

      {leagues.length > 0 ? (
        <section aria-labelledby="my-leagues" className="flex flex-col gap-2.5">
          <h2 id="my-leagues" className="text-xs uppercase tracking-[0.08em] font-mono m-0" style={{ color: 'var(--text-faint)' }}>Your leagues</h2>
          {leagues.map((l) => (
            <Link key={l.id} href={`/next/leagues/${l.id}`} className="next-card next-card-hover flex items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="font-display font-semibold truncate">{l.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {l.member_count} {l.member_count === 1 ? 'member' : 'members'}{l.owner_id === user.id ? ' · You run this league' : ''}
                </div>
              </div>
              <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>→</span>
            </Link>
          ))}
        </section>
      ) : (
        <div className="next-card p-6 flex flex-col gap-2">
          <p className="m-0 font-display font-bold text-lg">You&apos;re not in a league yet.</p>
          <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
            Start one and send the link to your group chat, or join one with a code a friend sent you.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <CreateLeagueForm />
        <JoinLeagueForm />
      </div>
    </div>
  );
}
