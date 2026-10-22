import { describe, expect, it } from 'vitest';
import { buildPrompt, unweighted, V2_FULL_BODY, V2_STANDING_NEGATIVE, withoutAbs, COVER_STOMACH_NEGATIVE, coversStomach } from './prompt';
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

describe('crop-top correction (test switch coverStomach)', () => {
  it('only for a covering top the request does not ask to show her stomach', () => {
    expect(coversStomach('white tank top, grey sweatpants')).toBe(true);
    expect(coversStomach('fitted black turtleneck, beige trousers')).toBe(true);
    expect(coversStomach('white crop top, grey sweatpants')).toBe(false);
    expect(coversStomach('cropped tank top showing her midriff')).toBe(false);
    expect(coversStomach('white bikini top, gray pajama shorts')).toBe(false);
    expect(coversStomach('white shirt tied at the waist')).toBe(false);
    expect(coversStomach('grey sweatpants')).toBe(false);
  });
  it('goes into the negative only when switched on; her figure wording is untouched', () => {
    const on = buildPrompt({ fields, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', coverStomach: true });
    const off = buildPrompt({ fields, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' });
    expect(on.negative).toContain(COVER_STOMACH_NEGATIVE);
    expect(off.negative).not.toContain(COVER_STOMACH_NEGATIVE);
    expect(on.positive).toBe(off.positive);
    expect(on.negative.replace(`, ${COVER_STOMACH_NEGATIVE}`, '')).toBe(off.negative);
    const crop = buildPrompt({ fields: { ...fields, outfit: 'white crop top, grey sweatpants' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', coverStomach: true });
    expect(crop.negative).not.toContain(COVER_STOMACH_NEGATIVE);
  });
});
