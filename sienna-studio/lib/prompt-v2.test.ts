import { describe, expect, it } from 'vitest';
import { buildPrompt, NATURAL_FIGURE, V2_FULL_BODY } from './prompt';
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
  it('keeps her identity, drops the weighted body descriptors, keeps her curves unweighted', () => {
    expect(v2.positive).toContain('long dark-brown wavy hair with lighter caramel ends');
    expect(v2.positive).toContain('freckles');
    expect(v2.positive).toContain(NATURAL_FIGURE);
    expect(v2.positive).not.toMatch(/breasts|defined abs|slim toned waist/);
    expect(v1.positive).toMatch(/large round natural breasts:1\.2/);
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
