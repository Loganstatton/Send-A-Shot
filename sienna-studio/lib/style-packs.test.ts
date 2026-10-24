import { describe, expect, it } from 'vitest';
import { activeStylePacks, STYLE_PACKS, stylePacksFor, withTriggers, withPackNegatives, packCoverage, withPackOutfit, nudeOnlyAllowed, toplessAllowed, packsForDescription, resolvePackConflicts } from './style-packs';

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
    const active = activeStylePacks({ natural_skin: 0.3, real_photo: 0.4 });
    expect(withTriggers('photo of sienna', active)).toBe('IGMODEL, detailed natural skin texture, photo of sienna');
    expect(withTriggers('IGMODEL, photo', active)).toBe('detailed natural skin texture, IGMODEL, photo');
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

  it('the recommended Micro bikini 0.85 + Natural skin 0.3 combination', () => {
    const byId = Object.fromEntries(STYLE_PACKS.map((p) => [p.id, p]));
    expect(byId.micro_bikini.default).toBe(0.85);
    expect(byId.natural_skin.default).toBe(0.3);
    expect(byId.micro_bikini.section).toBeUndefined();
    expect(byId.natural_skin.section).toBeUndefined();
  });
});

describe('swimwear and fitted packs (GPU-tested with Sienna)', () => {
  const byId = Object.fromEntries(STYLE_PACKS.map((p) => [p.id, p]));
  it('String swimsuit and Lace bodysuit are adult-only; Micro skirt is not offered (ignored colours in testing)', () => {
    expect(STYLE_PACKS.map((p) => p.id)).not.toContain('micro_skirt');
    for (const id of ['string_swimsuit', 'lace_bodysuit']) {
      expect(stylePacksFor('sfw').map((p) => p.id)).not.toContain(id);
      expect(stylePacksFor('adult').map((p) => p.id)).toContain(id);
    }
  });
  it('defaults and caps match the test results', () => {
    expect([byId.string_swimsuit.default, byId.string_swimsuit.max]).toEqual([0.6, 0.7]);
    expect([byId.lace_bodysuit.default, byId.lace_bodysuit.max]).toEqual([0.6, 0.8]);
    expect(activeStylePacks({ string_swimsuit: 0.8 }, 'adult')[0].strength).toBe(0.7);
  });
  it('natural descriptions get the trigger words automatically', () => {
    expect(withTriggers('tiny white string bikini', activeStylePacks({ string_swimsuit: 0.6 }, 'adult'))).toBe('string swimsuit, tiny white string bikini');
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

describe('pose packs', () => {
  it('are adult-only, and the sink selfie is capped so it cannot enlarge her hips', () => {
    for (const id of ['all_fours', 'sink_selfie', 'real_innie', 'realistic_nudes']) {
      expect(STYLE_PACKS.find((p) => p.id === id)?.section).toBe('adult');
      expect(activeStylePacks({ [id]: 0.6 }, 'sfw')).toEqual([]);
    }
    expect(activeStylePacks({ sink_selfie: 0.9 }, 'adult')[0].strength).toBe(0.6);
  });
});

describe('nude-only packs', () => {
  const ok = (outfit: string, rest: { pose?: string; bodyPresentation?: string; extra?: string } = {}) =>
    nudeOnlyAllowed('adult', { outfit, ...rest });

  it('only realistic nude body is nude-only', () => {
    expect(STYLE_PACKS.filter((p) => p.nudeOnly).map((p) => p.id)).toEqual(['realistic_nudes']);
  });

  it('runs on explicit nudity, with jewellery at most', () => {
    for (const o of ['completely nude', 'Naked', 'fully naked', 'nude', 'completely nude, gold necklace', 'nude with small hoop earrings', 'wearing nothing']) {
      expect(ok(o), o).toBe(true);
    }
  });

  it('never runs in SFW mode', () => {
    expect(nudeOnlyAllowed('sfw', { outfit: 'completely nude' })).toBe(false);
  });

  it('never runs on an empty or vague outfit', () => {
    for (const o of ['', '   ', 'casual', 'something cute', 'her usual look', 'summer vibes']) expect(ok(o), o).toBe(false);
  });

  it('never runs on clothed outfits', () => {
    for (const o of [
      'fitted bright red bodycon dress', 'black micro bikini', 'white bodysuit', 'black lace lingerie', 'red thong',
      'oversized hoodie', 'denim shorts', 'silk robe', 'towel wrapped around her', 'sheer mesh top', 'topless, denim shorts',
      'topless', 'nude bikini', 'nude-colored dress', 'nude lingerie', 'nude heels', 'completely nude, thigh-high stockings',
      'completely nude, high heels', 'naked except for a garter belt', 'nude, white socks', 'semi-nude', 'half-naked',
      'leather harness', 'nude with a sheet covering her', 'pasties',
    ]) {
      expect(ok(o), o).toBe(false);
    }
  });

  it('is blocked by clothing anywhere else in the request', () => {
    expect(ok('completely nude', { pose: 'holding a towel against her chest' })).toBe(false);
    expect(ok('completely nude', { extra: 'wearing a silk robe' })).toBe(false);
    expect(ok('completely nude', { bodyPresentation: 'partially covered' })).toBe(false);
    expect(ok('completely nude', { pose: 'standing, full body, front view', extra: 'soft window light' })).toBe(true);
  });
});

describe('round-3 adult packs', () => {
  it('are adult-only and off in SFW mode', () => {
    for (const id of ['belly_cutout_dress', 'mesh_top', 'underboob_shirt', 'lace_bandeau']) {
      expect(STYLE_PACKS.find((p) => p.id === id)?.section).toBe('adult');
      expect(activeStylePacks({ [id]: 0.6 }, 'sfw')).toEqual([]);
    }
  });

  it('revealing packs keep their full look and carry coverage wording for retries only', () => {
    const [a] = activeStylePacks({ underboob_shirt: 0.9 }, 'adult');
    expect(a.strength).toBe(0.7);
    expect(STYLE_PACKS.find((p) => p.id === 'underboob_shirt')?.default).toBe(0.6);
    expect(withPackNegatives('lowres', [a])).toBe('lowres');
    expect(packCoverage(['underboob_shirt', 'monokini', 'string_swimsuit', 'micro_bikini'])).toEqual({
      positive: 'triangle cups fully covering her chest, (wide straps covering her chest:1.4), (large round natural breasts:1.3)',
      negative: 'nipples, topless, (nipples, areola:1.6), exposed breasts',
    });
  });

  it('monokini is back at its full strength with a plain trigger', () => {
    const [a] = activeStylePacks({ monokini: 0.9 }, 'adult');
    expect(a.strength).toBe(0.6);
    expect(withTriggers('x', [a])).toBe('monokini, x');
  });
});

describe('pack outfit wording', () => {
  it('micro bikini adds its micro wording to the Outfit field once', () => {
    const a = activeStylePacks({ micro_bikini: 0.75 });
    expect(withPackOutfit('black micro bikini', a)).toBe('black micro bikini, tiny micro triangle bikini, very small triangle cups on thin string halter ties, tiny string bottoms tied at the hips');
    expect(withPackOutfit(withPackOutfit('black micro bikini.', a), a)).toBe(withPackOutfit('black micro bikini', a));
    expect(withPackOutfit('', a)).toBe('tiny micro triangle bikini, very small triangle cups on thin string halter ties, tiny string bottoms tied at the hips');
    expect(withPackOutfit('jeans', [])).toBe('jeans');
  });
});

describe('generate request schema', () => {
  it('keeps the hand, face-check and pose-preset settings', async () => {
    const { generateSchema } = await import('./schemas');
    const shape: any = (generateSchema as any).shape.params;
    const parsed = shape.safeParse({ ...(await import('./defaults')).DEFAULT_PARAMS, handRefine: false, faceCheck: false, posePreset: 'arms_crossed' });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ handRefine: false, faceCheck: false, posePreset: 'arms_crossed' });
  });
});

describe('the description wins over a pack\'s own outfit wording', () => {
  it('a named garment shape keeps the pack from adding its tiny-triangle wording', async () => {
    const { withPackOutfit, activeStylePacks } = await import('./style-packs');
    const micro = activeStylePacks({ micro_bikini: 0.85 }, 'sfw');
    expect(withPackOutfit('black micro bikini', micro)).toContain('tiny micro triangle bikini');
    expect(withPackOutfit('black micro bikini with high-waisted bottoms', micro)).toBe('black micro bikini with high-waisted bottoms');
  });
});

describe('24 Oct packs (fuller bust, laced lingerie, realistic breasts)', () => {
  it('adult mode only; the bust slider adds no trigger word', () => {
    const ids = stylePacksFor('sfw').map((p) => p.id);
    for (const id of ['fuller_bust', 'laced_lingerie', 'breast_detail']) expect(ids).not.toContain(id);
    const bust = activeStylePacks({ fuller_bust: 1 }, 'adult');
    expect(bust[0].strength).toBe(0.8);
    expect(withTriggers('photo of Sienna', bust)).toBe('photo of Sienna');
  });
  it('realistic breasts only on a bare chest', () => {
    expect(toplessAllowed('adult', { outfit: 'topless, tiny black thong' })).toBe(true);
    expect(toplessAllowed('adult', { outfit: 'completely nude' })).toBe(true);
    expect(toplessAllowed('sfw', { outfit: 'topless, tiny black thong' })).toBe(false);
    expect(toplessAllowed('adult', { outfit: 'tiny black thong' })).toBe(false);
    expect(toplessAllowed('adult', { outfit: 'topless, open white shirt' })).toBe(false);
    expect(toplessAllowed('adult', { outfit: 'topless, jeans', pose: 'hands covering her breasts' })).toBe(false);
    expect(toplessAllowed('adult', { outfit: 'nude-colour bra and panties' })).toBe(false);
  });
  it('picked from the description', () => {
    expect(packsForDescription({ outfit: 'topless, tiny black thong' }, 'adult')).toEqual({ breast_detail: 0.6 });
    expect(packsForDescription({ outfit: 'red lace lingerie' }, 'adult')).toEqual({ laced_lingerie: 0.8 });
    expect(packsForDescription({ outfit: 'lace bra and jeans' }, 'adult')).toEqual({});
    expect(packsForDescription({ outfit: 'tight white tank top', bodyPresentation: 'bigger breasts' }, 'adult')).toEqual({ fuller_bust: 0.8 });
  });
  it('one lingerie pack at a time; french lace by name wins; the nude-body pack over realistic breasts', () => {
    expect(resolvePackConflicts({ french_lace: 0.6, laced_lingerie: 0.8 })).toEqual({ packs: { french_lace: 0.6 }, dropped: ['laced_lingerie'] });
    expect(resolvePackConflicts({ realistic_nudes: 0.4, breast_detail: 0.6 }).packs).toEqual({ realistic_nudes: 0.4 });
  });
});
