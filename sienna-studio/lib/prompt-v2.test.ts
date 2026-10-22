import { describe, expect, it } from 'vitest';
import { buildPrompt, unweighted, V2_FULL_BODY, V2_STANDING_NEGATIVE, withoutAbs, COVER_STOMACH_NEGATIVE, COVER_FIT, KNOT_NEGATIVE, coverGarments } from './prompt';
import { DEFAULT_CHARACTER, EMPTY_FIELDS } from './defaults';
import { packFitsOutfit, packsForDescription } from './style-packs';

const fields = {
  ...EMPTY_FIELDS,
  outfit: 'white tank top, grey sweatpants',
  pose: 'sitting on the edge of her bed, hands clasped in her lap',
  expression: 'soft smile, looking at the camera',
  setting: 'cozy bedroom',
  lighting: 'warm morning light',
  camera: 'casual iPhone photo',
};

describe('prompt version 2', () => {
  const v2 = buildPrompt({ fields, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', version: 2 });
  const v1 = buildPrompt({ fields, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' });
  it('reads like a caption: camera, Sienna, pose, outfit, scene; identity after', () => {
    expect(v2.positive.startsWith('casual iPhone photo, sienna_v1 woman')).toBe(true);
    const at = (s: string) => v2.positive.indexOf(s);
    expect(at('sitting on the edge')).toBeLessThan(at('wearing'));
    expect(at('wearing')).toBeLessThan(at('cozy bedroom'));
    expect(at('cozy bedroom')).toBeLessThan(at('dark-brown wavy hair'));
  });
  it('keeps her identity and her figure word for word, only without the emphasis weights', () => {
    expect(v2.positive).toContain('long dark-brown wavy hair with lighter caramel ends');
    expect(v2.positive).toContain('freckles');
    expect(v2.positive).toContain('large round natural breasts, slim toned waist with defined abs, curvy hips');
    expect(v2.positive).not.toMatch(/(breasts|waist|hips)[^,]*:1\.\d/);
    expect(v2.negative).toMatch(/small breasts, flat chest/);
    expect(v1.positive).toMatch(/large round natural breasts:1\.2/);
    expect(unweighted('(large round natural breasts:1.2)')).toBe('large round natural breasts');
    expect(unweighted('curvy hips')).toBe('curvy hips');
  });
  it('a standing request pushes sitting away (furniture pulled her onto the sofa); other poses do not', () => {
    const st = buildPrompt({ fields: { ...fields, pose: 'standing, arms relaxed at sides' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', version: 2 });
    expect(st.negative).toContain(V2_STANDING_NEGATIVE);
    expect(v2.negative).not.toContain(V2_STANDING_NEGATIVE);
    const both = buildPrompt({ fields: { ...fields, pose: 'standing up from sitting on the bed' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', version: 2 });
    expect(both.negative).not.toContain(V2_STANDING_NEGATIVE);
  });
  it('is much shorter than version 1, with three realism phrases instead of fifteen', () => {
    expect(v2.positive.length).toBeLessThan(v1.positive.length * 0.75);
    expect(v2.positive).not.toMatch(/believable reflections|anatomically correct hands|wide-angle phone lens distortion/);
    expect(v2.negative).toMatch(/orange tan/);
  });
  it('full-body: natural proportions, no "wide shot, several meters away"; stretched figures in the negative', () => {
    const fb = buildPrompt({ fields: { ...fields, framing: 'full body' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', version: 2 });
    expect(fb.positive).toContain(V2_FULL_BODY);
    expect(fb.positive).not.toMatch(/wide shot|several meters/);
    expect(fb.negative).toMatch(/elongated legs/);
    expect(fb.positive).not.toMatch(/long legs/);
  });
  it('gives the outfit phrase on its own for separate encoding', () => {
    expect(v2.outfitPart).toMatch(/^wearing .*white tank top.*grey sweatpants/);
    expect(v2.positive).toContain(v2.outfitPart!);
  });
});

describe('outfit packs never replace a named garment', () => {
  it('bikini top with gray shorts: no bikini pack', () => {
    expect(packFitsOutfit('micro_bikini', 'white micro bikini top, light gray pajama shorts')).toBe(false);
    expect(packsForDescription({ outfit: 'white micro bikini top, light gray pajama shorts' }, 'adult').micro_bikini).toBeUndefined();
  });
  it('a whole bikini: the pack fits', () => {
    expect(packFitsOutfit('micro_bikini', 'pastel pink micro bikini, thong bottoms')).toBe(true);
    expect(packFitsOutfit('string_swimsuit', 'pastel pink string bikini with thong bottoms, barefoot')).toBe(true);
    expect(packsForDescription({ outfit: 'tiny pastel pink micro bikini' }, 'adult').micro_bikini).toBeGreaterThan(0);
  });
  it('packs that draw no outfit always fit', () => {
    expect(packFitsOutfit('natural_skin', 'white tank top, grey sweatpants')).toBe(true);
  });
});

describe('figure without the defined-abs wording (test switch)', () => {
  it('removes only "with defined abs"; bust, waist and hips stay as written, weights included', () => {
    const t = withoutAbs(DEFAULT_CHARACTER.appearanceTraits);
    expect(t).toContain('(large round natural breasts:1.2), slim toned waist, curvy hips');
    expect(t).not.toMatch(/abs\b/);
    expect(t.replace('slim toned waist,', 'slim toned waist with defined abs,')).toBe(DEFAULT_CHARACTER.appearanceTraits);
    const v1 = buildPrompt({ fields, character: { ...DEFAULT_CHARACTER, appearanceTraits: t }, siennaLock: true, contentMode: 'sfw' });
    expect(v1.positive).toContain('(large round natural breasts:1.2), slim toned waist, curvy hips');
  });
});

describe('full-length fit for ordinary T-shirts, tank tops and button-ups (coverStomach)', () => {
  it('only the three garments that came out cropped get anything; sweaters, dresses etc. are left alone', () => {
    expect(coverGarments('white tank top, grey sweatpants')).toEqual(['tank']);
    expect(coverGarments('fitted white crew-neck t-shirt, blue jeans')).toEqual(['tee']);
    expect(coverGarments('light blue button-up shirt, white denim shorts')).toEqual(['buttonup']);
    expect(coverGarments('white button-down oxford shirt, jeans')).toEqual(['buttonup']);
    for (const o of ['cream knit sweater, black trousers', 'fitted black turtleneck, beige trousers', 'black slip dress', 'navy hoodie, leggings', 'grey sweatpants'])
      expect(coverGarments(o), o).toEqual([]);
  });
  it('a requested style always wins: crop tops, tied/knotted/tucked/open shirts, bikinis and similar get nothing', () => {
    for (const o of [
      'white crop top, jeans', 'cropped t-shirt, jeans', 'cropped hoodie, leggings', 'black sports bra, leggings', 'lace bralette, jeans', 'pink string bikini',
      'white shirt tied at the waist, denim shorts', 'knotted t-shirt, jeans', 'tie-front blouse, skirt', 'bandeau top, shorts', 'tube top, skirt',
      'half shirt, joggers', 'unbuttoned shirt over a bikini top', 'open button-up shirt, shorts', 'button-up shirt tucked into jeans', 'tucked-in tee, skirt',
      'cut-out one-piece swimsuit', 'tank top showing her midriff', 't-shirt pulled up to show her abs', 'white tank top over a bikini',
    ]) expect(coverGarments(o), o).toEqual([]);
  });
  it('only the enabled garments are used (rollback per garment)', () => {
    expect(coverGarments('white t-shirt and a tank top', ['tank'])).toEqual(['tank']);
    expect(coverGarments('light blue button-up shirt', [])).toEqual([]);
  });
  it('fit wording follows the outfit, negatives get crop-top (and knot) wording; her figure wording is untouched', () => {
    const tee = { ...fields, outfit: 'white t-shirt, blue jeans' };
    const on = buildPrompt({ fields: tee, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', coverStomach: true });
    const off = buildPrompt({ fields: tee, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' });
    expect(on.positive).toContain(`(blue jeans:1.1), ${COVER_FIT.tee}`);
    expect(on.positive.replace(`, ${COVER_FIT.tee}`, '')).toBe(off.positive);
    expect(on.negative).toContain(COVER_STOMACH_NEGATIVE);
    expect(on.negative).not.toContain(KNOT_NEGATIVE);
    expect(on.positive).toContain('(large round natural breasts:1.2), slim toned waist with defined abs, curvy hips');
    const shirt = buildPrompt({ fields: { ...fields, outfit: 'light blue button-up shirt, white shorts' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', coverStomach: ['buttonup'] });
    expect(shirt.positive).toContain(COVER_FIT.buttonup);
    expect(shirt.negative).toContain(KNOT_NEGATIVE);
    const crop = buildPrompt({ fields: { ...fields, outfit: 'white crop top, grey sweatpants' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', coverStomach: true });
    const cropOff = buildPrompt({ fields: { ...fields, outfit: 'white crop top, grey sweatpants' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' });
    expect([crop.positive, crop.negative]).toEqual([cropOff.positive, cropOff.negative]);
  });
});
