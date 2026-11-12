import { safeReturnPath } from './return-path';

// Where a new player signed up from, worked out from the page they were
// sent back to after signing up (the ?next= path every "Sign up" link on
// NEXT carries). Only the category and the path are stored — never a
// referrer URL from another site, and nothing that identifies who shared
// the link.
export type SignupSource =
  | 'league_invite' | 'proof_link' | 'artist_page' | 'genre_page' | 'collection' | 'leaderboard' | 'profile' | 'discover' | 'direct';

export function classifySignupSource(rawPath: unknown): { via: SignupSource; path: string | null } {
  const path = typeof rawPath === 'string' ? safeReturnPath(rawPath, '/') : null;
  if (!path || path === '/') return { via: 'direct', path: null };
  const p = path.split('?')[0];
  if (p.startsWith('/next/leagues/join/')) return { via: 'league_invite', path: '/next/leagues/join/…' };
  if (p.startsWith('/next/proof/')) return { via: 'proof_link', path: p };
  if (/^\/next\/artists\/\d+/.test(p)) return { via: 'artist_page', path: p.match(/^\/next\/artists\/\d+/)![0] };
  if (p.startsWith('/next/genres')) return { via: 'genre_page', path: p };
  if (p.startsWith('/next/collections/')) return { via: 'collection', path: p };
  if (p.startsWith('/next/leaderboard')) return { via: 'leaderboard', path: '/next/leaderboard' };
  if (p.startsWith('/next/profile/')) return { via: 'profile', path: p };
  if (p === '/next') return { via: 'discover', path: p };
  return { via: 'direct', path: p.slice(0, 100) };
}
