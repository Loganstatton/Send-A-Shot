import Link from 'next/link';
import type { Metadata } from 'next';
import { getSessionUser } from '@/lib/auth';
import { getUserById, logEvent } from '@/lib/db';
import { getLeagueByCode, getLeagueMemberCount, isLeagueMember, LEAGUE_MAX_MEMBERS } from '@/lib/leagues';
import { JoinLeagueButton } from '@/components/next/LeagueControls';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await props.params;
  const league = await getLeagueByCode(code);
  const title = league ? `Join ${league.name} on NEXT` : 'League invite';
  const description = 'A private NEXT league: find emerging artists before everyone else, and see who in your group calls it first.';
  return { title, description, robots: { index: false }, openGraph: { title, description }, twitter: { card: 'summary', title, description } };
}

// Where an invite link lands. Anyone holding the link can see the league's
// name, who runs it and how many are in it — nothing about the members.
export default async function JoinLeaguePage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const league = await getLeagueByCode(code);
  const viewer = await getSessionUser();

  if (!league) {
    return (
      <div className="next-card p-8 max-w-[560px] mx-auto flex flex-col gap-3 text-center items-center">
        <h1 className="font-display font-bold text-2xl m-0">This invite link doesn&apos;t work</h1>
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          It may have been typed wrong, or the league owner made a new link. Ask them to send it again.
        </p>
        <Link href={viewer ? '/next/leagues' : '/next'} className="next-btn-ghost text-sm px-4 py-2.5 rounded-[10px]">
          {viewer ? 'Your leagues' : 'Explore NEXT'}
        </Link>
      </div>
    );
  }

  const [owner, memberCount, alreadyMember] = await Promise.all([
    getUserById(league.owner_id),
    getLeagueMemberCount(league.id),
    viewer ? isLeagueMember(league.id, viewer.id) : Promise.resolve(false),
  ]);
  await logEvent(viewer?.id ?? null, 'league_invite_viewed', { leagueId: league.id, guest: !viewer });
  const full = memberCount >= LEAGUE_MAX_MEMBERS;
  const here = `/next/leagues/join/${league.invite_code}`;

  return (
    <div className="next-card p-8 max-w-[560px] mx-auto flex flex-col gap-4">
      <p className="m-0 text-xs font-mono uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>You&apos;re invited to a private league</p>
      <h1 className="font-display font-bold text-[30px] m-0 leading-tight break-words">{league.name}</h1>
      <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
        {owner ? <>Run by <strong style={{ color: 'var(--text)' }}>{owner.name}</strong> · </> : null}
        {memberCount} {memberCount === 1 ? 'member' : 'members'}
      </p>
      <p className="m-0 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Back emerging artists with free virtual credits. Everyone in the league is ranked by how their picks do from the
        day they join — so you start level, however long the others have been playing.
      </p>

      {alreadyMember ? (
        <Link href={`/next/leagues/${league.id}`} className="next-btn-primary w-fit px-5 py-2.5 rounded-[10px] text-sm font-semibold">You&apos;re in — see standings</Link>
      ) : full ? (
        <p role="status" className="m-0 text-sm font-semibold" style={{ color: 'var(--down)' }}>This league is full ({LEAGUE_MAX_MEMBERS} members).</p>
      ) : viewer ? (
        <JoinLeagueButton code={league.invite_code} leagueName={league.name} />
      ) : (
        <div className="flex gap-3 flex-wrap items-center">
          <Link href={`/signup?next=${encodeURIComponent(here)}`} className="next-btn-primary px-5 py-2.5 rounded-[10px] text-sm font-semibold">Sign up free to join</Link>
          <Link href={`/login?next=${encodeURIComponent(here)}`} className="next-btn-ghost px-5 py-2.5 rounded-[10px] text-sm">I have an account</Link>
        </div>
      )}
      <p className="m-0 text-xs" style={{ color: 'var(--text-faint)' }}>
        NEXT is a game. Credits are virtual and can&apos;t be bought or cashed out. <Link href="/next/how-it-works" className="underline underline-offset-2">How it works</Link>
      </p>
    </div>
  );
}
