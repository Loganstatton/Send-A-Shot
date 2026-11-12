import { describe, expect, it } from 'vitest';
import { safeReturnPath, withReturnPath } from './return-path';

describe('safeReturnPath — where to go after logging in', () => {
  it('keeps a path on this site, including its query string', () => {
    expect(safeReturnPath('/next/artists/12')).toBe('/next/artists/12');
    expect(safeReturnPath('/next/leaderboard?window=week')).toBe('/next/leaderboard?window=week');
  });

  it('refuses anything that could leave the site', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'next/artists/1', '/next\n/x']) {
      expect(safeReturnPath(bad)).toBe('/next');
    }
  });

  it('never loops back to the login or signup page', () => {
    expect(safeReturnPath('/login')).toBe('/next');
    expect(safeReturnPath('/signup?next=/x')).toBe('/next');
  });

  it('uses the fallback for missing values', () => {
    expect(safeReturnPath(undefined)).toBe('/next');
    expect(safeReturnPath(null, '/')).toBe('/');
    expect(safeReturnPath('', '/')).toBe('/');
  });

  it('withReturnPath encodes a safe path and drops an unsafe one', () => {
    expect(withReturnPath('/login', '/next/artists/3?ref=feed')).toBe('/login?next=%2Fnext%2Fartists%2F3%3Fref%3Dfeed');
    expect(withReturnPath('/login', '//evil.example')).toBe('/login');
    expect(withReturnPath('/signup', null)).toBe('/signup');
  });
});
