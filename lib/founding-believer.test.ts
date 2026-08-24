import { describe, expect, it } from 'vitest';
import { foundingBelieverSerial, getFoundingBelieverTier } from './founding-believer';

describe('getFoundingBelieverTier', () => {
  it('rank 1 is Genesis Founder', () => {
    expect(getFoundingBelieverTier(1)).toEqual({ key: 'genesis', label: 'Genesis Founder', edition: 'Genesis' });
  });

  it('ranks 2-10 are Founding Believer', () => {
    expect(getFoundingBelieverTier(2).key).toBe('founding');
    expect(getFoundingBelieverTier(10).key).toBe('founding');
  });

  it('ranks 11-50 are Early Believer', () => {
    expect(getFoundingBelieverTier(11).key).toBe('early');
    expect(getFoundingBelieverTier(50).key).toBe('early');
  });

  it('ranks 51+ are First Wave, with no upper bound', () => {
    expect(getFoundingBelieverTier(51).key).toBe('first-wave');
    expect(getFoundingBelieverTier(10_000).key).toBe('first-wave');
  });

  it('band boundaries are exact — 10 is founding, 11 is early; 50 is early, 51 is first-wave', () => {
    expect(getFoundingBelieverTier(10).key).toBe('founding');
    expect(getFoundingBelieverTier(11).key).toBe('early');
    expect(getFoundingBelieverTier(50).key).toBe('early');
    expect(getFoundingBelieverTier(51).key).toBe('first-wave');
  });
});

describe('foundingBelieverSerial', () => {
  it('builds initials from a multi-word artist name, zero-padded rank', () => {
    expect(foundingBelieverSerial('Zach Bryan', 1)).toBe('FB-ZB-000001');
  });

  it('caps at 3 initials for long names', () => {
    expect(foundingBelieverSerial('The Long Way Home Collective', 42)).toBe('FB-TLW-000042');
  });

  it('falls back to NX for a name with no usable initials', () => {
    expect(foundingBelieverSerial('   ', 7)).toBe('FB-NX-000007');
  });

  it('handles a single-word artist name', () => {
    expect(foundingBelieverSerial('Adele', 3)).toBe('FB-A-000003');
  });
});
