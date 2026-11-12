import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { getLeagueById, getLeagueStandings, isLeagueMember } from '@/lib/leagues';
import ArtistAvatar from '@/components/ArtistAvatar';
import { LeagueInvitePanel, LeaveLeagueButton, RemoveMemberButton } from '@/components/next/LeagueControls';

export const dynamic = 'force-dynamic';
// A league's name is only for its members; keep it out of tab titles a
// non-member could see and out of search engines.
export const metadata: Metadata = { title: 'League', robots: { index: false } };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Members only. A non-member gets the same not-found page as a league that
// doesn't exist, so league ids can't be probed for names.
export default async function LeaguePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await requireUser();
  const leagueId = Number(params.id);
  if (!Number.isInteger(leagueId)) notFound();
  const league = await getLeagueById(leagueId);
  if (!league || !(await isLeagueMember(league.id, user.id))) notFound();

  const standings = await getLeagueStandings(league);
  const isOwner = league.owner_id === user.id;
  const anyBacked = standings.some((s) => s.artistsBackedCount > 0);

  return (
    <div className="flex flex-col gap-6 max-w-[780px]">
      <div className="flex flex-col gap-1">
        <Link href="/next/leagues" className="text-sm w-fit" style={{ color: 'var(--text-faint)' }}>← Leagues</Link>
        <h1 className="font-display font-bold text-[32px] m-0 tracking-[-0.01em] break-words">{league.name}</h1>
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          {standings.length} {standings.length === 1 ? 'member' : 'members'} · Ranked by portfolio return since each person joined.
          Virtual credits only.
        </p>
      </div>

      <LeagueInvitePanel leagueId={league.id} leagueName={league.name} inviteCode={league.invite_code} isOwner={isOwner} />

      <section aria-labelledby="standings" className="flex flex-col gap-2.5">
        <h2 id="standings" className="text-xs uppercase tracking-[0.08em] font-mono m-0" style={{ color: 'var(--text-faint)' }}>Standings</h2>
        {!anyBacked && (
          <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
            Nobody here has backed an artist yet. <Link href="/next" className="underline underline-offset-2" style={{ color: 'var(--text)' }}>Find one on Discover</Link> to take the lead.
          </p>
        )}
        <ol className="flex flex-col gap-2.5 list-none p-0 m-0">
          {standings.map((s) => {
            const up = s.returnSincePct >= 0;
            const isMe = s.user.id === user.id;
            return (
              <li key={s.user.id} className="next-card flex items-center gap-3 px-5 py-4" style={isMe ? { borderColor: 'var(--ember)' } : undefined}>
                <span className="num w-8 text-center text-sm font-semibold shrink-0" style={{ color: 'var(--text-faint)' }}>#{s.rank}</span>
                <ArtistAvatar name={s.user.name} photoUrl={s.user.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link href={`/next/profile/${s.user.id}`} className="font-display font-semibold truncate block hover:underline underline-offset-2">
                    {s.user.name}{isMe ? ' (you)' : ''}
                  </Link>
                  <div className="text-xs truncate" style={{ color: 'var(--text-faint)' }}>
                    {s.isOwner ? 'Owner · ' : ''}Joined {formatDate(s.joined_at)} · {s.artistsBackedCount} artists backed
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="num font-semibold" style={{ color: s.returnSincePct === 0 ? 'var(--text)' : up ? 'var(--up)' : 'var(--down)' }}>
                    {up ? '+' : ''}{s.returnSincePct}%
                  </div>
                  <div className="num text-xs" style={{ color: 'var(--text-faint)' }}>{formatCents(s.portfolioValueCents)}</div>
                </div>
                {isOwner && !isMe && <RemoveMemberButton leagueId={league.id} userId={s.user.id} name={s.user.name} />}
              </li>
            );
          })}
        </ol>
      </section>

      <LeaveLeagueButton leagueId={league.id} isOwner={isOwner} memberCount={standings.length} />
    </div>
  );
}
