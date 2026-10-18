import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARACTER } from './defaults';
import { applyClothingChanges, clothingChanges, interpretPrompt, referenceIntent, splitNegatives } from './interpret';
import { buildPrompt } from './prompt';

const character = { ...DEFAULT_CHARACTER, triggerToken: 'sienna_v1' };
const KITCHEN =
  "Generate Sienna standing in her kitchen taking a casual iPhone 16 photo. She's wearing gray pajama shorts and a loose white crop top. Her long brunette hair is slightly messy. She has one leg resting straight on the kitchen counter. The kitchen is modern with white cabinets and natural morning lighting. Her face should look exactly like Sienna's established appearance. Make everything look like a real, unedited photograph taken on an iPhone.";

describe('interpretPrompt — the kitchen example', () => {
  const r = interpretPrompt(KITCHEN, { defaultMode: 'sfw' });
  it('files each sentence, in the user’s own words, under the right field', () => {
    expect(r.fields.outfit).toBe("She's wearing gray pajama shorts and a loose white crop top");
    expect(r.fields.pose).toContain('one leg resting straight on the kitchen counter');
    expect(r.fields.pose).toMatch(/^standing in her kitchen taking a casual iPhone 16 photo/);
    expect(r.fields.setting).toBe('The kitchen is modern with white cabinets and natural morning lighting');
    expect(r.fields.bodyPresentation).toBe('Her long brunette hair is slightly messy');
    expect(r.fields.camera).toBe('a real, unedited photograph taken on an iPhone');
  });
  it('drops the app instructions and the identity-only sentence (her profile handles identity)', () => {
    const all = Object.values(r.fields).join(' ');
    expect(all).not.toMatch(/\bGenerate\b|established appearance|\bSienna\b|everything look/);
    expect(r.notes.join(' ')).toContain('come from her profile');
  });
  it('loses nothing else: every other word of the description reaches the prompt', () => {
    const p = buildPrompt({ fields: r.fields, character, siennaLock: true, contentMode: 'sfw' }).positive;
    for (const phrase of ['gray pajama shorts', 'loose white crop top', 'leg resting straight on the kitchen counter', 'white cabinets', 'natural morning lighting', 'iPhone 16', 'unedited photograph'])
      expect(p).toContain(phrase);
    // the profile's default lighting phrase would contradict "natural morning lighting"
    expect(p).not.toContain('indoor lighting');
  });
});

describe('negatives and conflicts', () => {
  it('turns "no / without / avoid / don’t" phrases into Avoid terms instead of positive words', () => {
    const r = interpretPrompt('Sienna on a sunny beach in a red sundress, no sunglasses, without jewelry, not looking at the camera, avoid harsh shadows.');
    expect(r.fields.avoid).toBe('sunglasses, jewelry, looking at the camera, harsh shadows');
    expect(Object.entries(r.fields).filter(([k]) => k !== 'avoid').map(([, v]) => v).join(' ')).not.toMatch(/sunglasses|jewelry|harsh shadows/);
  });
  it('keeps comparisons like "not too bright" as written', () => {
    expect(splitNegatives('warm light, not too bright')).toEqual(['warm light, not too bright', []]);
  });
  it('Test D: hidden defaults never replace an explicit outfit, pose or place', () => {
    const r = interpretPrompt('Sienna in a black leather jacket and jeans, sitting cross-legged on a rooftop in Tokyo at night, neon lights, shot on a DSLR with a 50mm lens.');
    const b = buildPrompt({ fields: r.fields, character, siennaLock: true, contentMode: 'sfw' });
    expect(b.positive).toContain('black leather jacket and jeans');
    expect(b.positive).toContain('sitting cross-legged on a rooftop in Tokyo');
    expect(b.positive).toContain('neon lights');
    // no default phone camera / iPhone realism against an explicit DSLR, no indoor-lighting default outdoors
    expect(b.positive).not.toMatch(/iPhone|indoor lighting/);
  });
  it('switches to adult mode only when nudity or adult wardrobe is asked for and the server allows it', () => {
    expect(interpretPrompt('Sienna in black lace lingerie on her bed', { adultAllowed: true }).contentMode).toBe('adult');
    expect(interpretPrompt('Sienna in black lace lingerie on her bed', { adultAllowed: false }).contentMode).toBe('sfw');
    expect(interpretPrompt('Sienna in a red dress, no lingerie showing', { adultAllowed: true }).contentMode).toBe('sfw');
  });
});

describe('reference photos', () => {
  it('Test C: "keep the same pose, change the background and clothes" copies the pose, redraws the rest', () => {
    const t = 'Use this photograph as the reference. Keep the same overall pose, but replace the background with a modern kitchen, change the clothing, and make the final result look like a realistic iPhone photograph of Sienna.';
    const r = interpretPrompt(t, { hasReference: true });
    expect(r.reference.mode).toBe('pose');
    expect(r.fields.setting).toBe('a modern kitchen background');
    expect(r.fields.camera).toBe('a realistic iPhone photograph of her');
    expect(Object.values(r.fields).join(' ')).not.toMatch(/use this photograph|keep the same/i);
  });
  it('edits in place when the composition is kept and only small changes are asked', () => {
    expect(referenceIntent('Keep everything the same, just change her hair to a ponytail', true)).toMatchObject({ mode: 'edit', denoise: 0.5 });
  });
  it('recreates the photo as Sienna when no instructions are given', () => {
    expect(referenceIntent('Sienna at the beach', true)).toMatchObject({ mode: 'edit+pose', denoise: 0.62 });
    expect(referenceIntent('Sienna at the beach', false).mode).toBe('none');
  });
});

describe('long descriptions', () => {
  it('keeps a 2,000-character description whole (no truncation)', () => {
    const long = Array.from({ length: 25 }, (_, i) => `Detail number ${i} about the soft knit sweater texture and the warm kitchen light`).join('. ');
    expect(long.length).toBeGreaterThan(2000);
    const r = interpretPrompt(long);
    const joined = Object.values(r.fields).join(' ');
    for (let i = 0; i < 25; i++) expect(joined).toContain(`Detail number ${i} `);
  });
});

describe('editing a studio photo (live test: "change her top to a red tank top" left the top gray and redrew the shorts)', () => {
  const EDIT = 'Keep everything the same, just change her top to a red tank top.';
  it('reads the garment swap instead of filing the instruction as outfit text', () => {
    expect(clothingChanges(EDIT)).toEqual([{ part: 'top', to: 'a red tank top' }]);
    expect(clothingChanges('Make her shorts black')).toEqual([{ part: 'bottom', to: 'black shorts' }]);
    expect(clothingChanges('Change her outfit to a blue sundress')).toEqual([{ part: 'outfit', to: 'a blue sundress' }]);
    const r = interpretPrompt(EDIT, { hasReference: true });
    expect(r.fields.outfit).toBe('wearing a red tank top');
    expect(Object.values(r.fields).join(' ')).not.toMatch(/keep everything|just change/i);
    expect(interpretPrompt('Keep everything the same, but make it a beach at sunset.').fields.setting).toBe('a beach at sunset');
  });
  it('swaps only that garment in the original outfit', () => {
    const outfit = "She's wearing gray pajama shorts and a loose white crop top";
    expect(applyClothingChanges(outfit, clothingChanges(EDIT))).toBe("She's wearing gray pajama shorts and a red tank top");
    expect(applyClothingChanges(outfit, clothingChanges('Make her shorts black'))).toBe("She's wearing black shorts and a loose white crop top");
    expect(applyClothingChanges(outfit, clothingChanges('Change her outfit to a blue sundress'))).toBe('wearing a blue sundress');
    expect(applyClothingChanges('wearing a red dress', [{ part: 'shoes', to: 'white sneakers' }])).toBe('wearing a red dress, white sneakers');
  });
  it('uses enough change for a recolour, with her pose held by the ControlNet', () => {
    expect(referenceIntent(EDIT, true)).toMatchObject({ mode: 'edit+pose', denoise: 0.62 });
    // small non-clothing edits stay gentle
    expect(referenceIntent('Keep everything the same, just make her smile', true)).toMatchObject({ mode: 'edit', denoise: 0.5 });
  });
});
