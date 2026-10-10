import { describe, expect, it } from 'vitest';
import { activeStylePacks, STYLE_PACKS, withTriggers } from './style-packs';

describe('activeStylePacks', () => {
  it('keeps packs above zero, clamps to each max, ignores unknown ids, in catalogue order', () => {
    const active = activeStylePacks({ natural_skin: 0.9, micro_bikini: 0.75, real_photo: 0, nope: 1 });
    expect(active.map((a) => [a.pack.id, a.strength])).toEqual([
      ['micro_bikini', 0.75],
      ['natural_skin', 0.4],
    ]);
  });

  it('treats missing, negative and non-numeric values as off', () => {
    expect(activeStylePacks(undefined)).toEqual([]);
    expect(activeStylePacks({ micro_bikini: -1, real_photo: NaN })).toEqual([]);
  });

  it('every pack has a sane default within its range', () => {
    for (const p of STYLE_PACKS) {
      expect(p.default).toBeGreaterThan(0);
      expect(p.default).toBeLessThanOrEqual(p.max);
      expect(p.file).toMatch(/\.safetensors$/);
    }
  });
});

describe('withTriggers', () => {
  it('puts trigger words first and does not repeat one already in the prompt', () => {
    const active = activeStylePacks({ micro_bikini: 0.75, real_photo: 0.4 });
    expect(withTriggers('photo of sienna', active)).toBe('microbikini, IGMODEL, photo of sienna');
    expect(withTriggers('microbikini, photo', active)).toBe('IGMODEL, microbikini, photo');
    expect(withTriggers('photo', [])).toBe('photo');
  });
});
