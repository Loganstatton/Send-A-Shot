import { describe, expect, it } from 'vitest';
import { activeStylePacks, STYLE_PACKS, stylePacksFor, withTriggers } from './style-packs';

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

describe('adult-fashion packs', () => {
  it('French lace is only offered and applied in adult mode', () => {
    expect(stylePacksFor('sfw').map((p) => p.id)).not.toContain('french_lace');
    expect(stylePacksFor('adult').map((p) => p.id)).toContain('french_lace');
    expect(activeStylePacks({ french_lace: 0.6, natural_skin: 0.3 }, 'sfw').map((a) => a.pack.id)).toEqual(['natural_skin']);
    expect(activeStylePacks({ french_lace: 0.6, natural_skin: 0.3 }, 'adult').map((a) => [a.pack.id, a.strength])).toEqual([
      ['natural_skin', 0.3],
      ['french_lace', 0.6],
    ]);
  });

  it('French lace defaults to 0.6, caps at 0.8, and adds its trigger words', () => {
    const lace = STYLE_PACKS.find((p) => p.id === 'french_lace')!;
    expect([lace.default, lace.max]).toEqual([0.6, 0.8]);
    expect(activeStylePacks({ french_lace: 1 }, 'adult')[0].strength).toBe(0.8);
    expect(withTriggers('white lace bra and panties', activeStylePacks({ french_lace: 0.6 }, 'adult'))).toBe(
      'french_lace_lingerie, delicate lace lingerie, white lace bra and panties',
    );
  });

  it('the recommended Micro bikini 0.75 + Natural skin 0.3 combination is unchanged', () => {
    const byId = Object.fromEntries(STYLE_PACKS.map((p) => [p.id, p]));
    expect(byId.micro_bikini.default).toBe(0.75);
    expect(byId.natural_skin.default).toBe(0.3);
    expect(byId.micro_bikini.section).toBeUndefined();
    expect(byId.natural_skin.section).toBeUndefined();
  });
});

describe('swimwear and fitted packs (GPU-tested with Sienna)', () => {
  const byId = Object.fromEntries(STYLE_PACKS.map((p) => [p.id, p]));
  it('Micro skirt is SFW; String swimsuit and Lace bodysuit are adult-only', () => {
    expect(stylePacksFor('sfw').map((p) => p.id)).toContain('micro_skirt');
    for (const id of ['string_swimsuit', 'lace_bodysuit']) {
      expect(stylePacksFor('sfw').map((p) => p.id)).not.toContain(id);
      expect(stylePacksFor('adult').map((p) => p.id)).toContain(id);
    }
  });
  it('defaults and caps match the test results', () => {
    expect([byId.micro_skirt.default, byId.micro_skirt.max]).toEqual([0.6, 0.8]);
    expect([byId.string_swimsuit.default, byId.string_swimsuit.max]).toEqual([0.6, 0.7]);
    expect([byId.lace_bodysuit.default, byId.lace_bodysuit.max]).toEqual([0.6, 0.8]);
    expect(activeStylePacks({ string_swimsuit: 0.8 }, 'adult')[0].strength).toBe(0.7);
  });
  it('natural descriptions get the trigger words automatically', () => {
    expect(withTriggers('tiny white string bikini', activeStylePacks({ string_swimsuit: 0.6 }, 'adult'))).toBe('string swimsuit, tiny white string bikini');
    expect(withTriggers('black pleated micro skirt', activeStylePacks({ micro_skirt: 0.6 }, 'sfw'))).toBe('microskirt, black pleated micro skirt');
  });
  it('Natural skin uses the shortened trigger', () => {
    expect(byId.natural_skin.trigger).toBe('detailed natural skin texture');
  });
});

describe('thin white shirt pack', () => {
  it('is adult-only, defaults to 0.4 and stays below the sheer range', () => {
    const p = STYLE_PACKS.find((x) => x.id === 'wet_tshirt')!;
    expect(p.section).toBe('adult');
    expect([p.default, p.max]).toEqual([0.4, 0.45]);
    expect(activeStylePacks({ wet_tshirt: 0.7 }, 'adult')[0].strength).toBe(0.45);
    expect(activeStylePacks({ wet_tshirt: 0.4 }, 'sfw')).toEqual([]);
  });
});
