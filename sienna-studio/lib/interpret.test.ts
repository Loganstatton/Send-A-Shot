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

describe('style packs from the description', () => {
  const packs = (t: string, adultAllowed = true) => interpretPrompt(t, { adultAllowed }).packs;
  it('switches on the pack the outfit names, at its default strength', () => {
    expect(packs('Sienna on the beach in a black micro bikini', false)).toEqual({ micro_bikini: 0.85 });
    expect(packs('Sienna in a white lace bra and panties on her bed')).toEqual({ laced_lingerie: 0.8 });
    expect(packs('Sienna in white french lace lingerie on her bed')).toEqual({ french_lace: 0.6 });
    expect(packs('Sienna in a black plunging monokini by the pool')).toEqual({ monokini: 0.5 });
    expect(packs('Sienna in a thin white cotton t-shirt and denim shorts, real photo')).toEqual({ wet_tshirt: 0.4 });
  });
  it('adult packs only in adult mode', () => {
    expect(packs('Sienna in a red string bikini', false)).toEqual({});
    expect(packs('Sienna in a red string bikini')).toEqual({ string_swimsuit: 0.6 });
  });
  it('a micro string bikini gets one bikini pack, not two', () => {
    expect(packs('Sienna in a micro string bikini')).toEqual({ string_swimsuit: 0.7 });
  });
  it('nothing for "no lingerie", nothing for ordinary outfits', () => {
    expect(packs('Sienna in a red dress, no lingerie showing')).toEqual({});
    expect(packs('Sienna in gray pajama shorts and a loose white crop top in her kitchen')).toEqual({});
  });
  it('the nude pack only for a fully nude outfit', () => {
    expect(packs('Sienna completely nude on her bed')).toEqual({ realistic_nudes: 0.4 });
    expect(packs('Sienna nude except for a white towel')).not.toHaveProperty('realistic_nudes');
  });
  it('at most two packs', () => {
    expect(Object.keys(packs('Sienna in a black micro bikini on all fours, natural skin texture with visible pores'))).toHaveLength(2);
  });
  it('the note says which packs', () => {
    expect(interpretPrompt('Sienna in a black micro bikini').notes.join(' ')).toContain('Micro bikini (0.85)');
  });
});

describe('outfit split from the place (live prompt: the pool and villa were filed under Outfit)', () => {
  it('"standing beside a pool …, wearing a pink micro bikini …" files the bikini alone as the outfit', () => {
    const r = interpretPrompt('Sienna standing beside a beautiful infinity pool at a luxury villa in Miami, wearing a tiny pastel pink micro bikini with thin side ties and matching thong bottoms.');
    expect(r.fields.outfit).toBe('wearing a tiny pastel pink micro bikini with thin side ties and matching thong bottoms');
    expect(Object.values(r.fields).join(' ')).toContain('infinity pool at a luxury villa in Miami');
  });
});

describe('live pool prompt, 18 Oct (arms-down preset from the photographer sentence; sandals despite "barefoot")', () => {
  const POOL = `Sienna posing beside a beautiful infinity pool at a luxury villa in Miami.

She’s wearing a tiny pastel pink string bikini with thin side straps and matching thong bottoms. She’s barefoot.

Her body is turned at a three-quarter angle with her right hip slightly toward the camera. Her left hand rests on her hip while her right hand brushes her hair behind her ear. Her left leg supports her weight and her right foot is positioned slightly forward.

She’s looking over her shoulder toward the camera with a relaxed, confident smile.

The background features a turquoise infinity pool, white stone patio, palm trees, and a modern luxury villa.

Golden hour, low warm sun, long natural shadows.

A friend is taking the picture using an iPhone 16 Pro, standing approximately seven feet away and holding the phone vertically at waist height.

Full-body photograph, head to toe, with her entire figure and both bare feet visible.

Realistic, unedited, natural skin texture, authentic smartphone photography.

No sunglasses, no jewelry, no cover-up.`;
  const r = interpretPrompt(POOL, { adultAllowed: true });
  it('the photographer sentence is camera, not her pose', () => {
    expect(r.fields.camera).toContain('A friend is taking the picture');
    expect(r.fields.pose).not.toMatch(/standing|friend/);
  });
  it('no automatic standing preset: her hands and legs are described', async () => {
    const { matchPosePreset } = await import('./pose-presets');
    const { fullBodyFraming } = await import('./prompt');
    expect(fullBodyFraming(r.fields).add).toBe(true);
    expect(matchPosePreset(r.fields.pose, true)).toBeUndefined();
  });
  it('barefoot: bare feet in the framing, footwear in the negative', () => {
    const b = buildPrompt({ fields: r.fields, character, siennaLock: true, contentMode: 'adult' });
    expect(b.positive).toContain('including her bare feet');
    expect(b.positive).not.toContain('feet and shoes');
    expect(b.negative).toContain('sandals');
  });
});

describe('tiny string bikini (live: regular-size cups at the 0.6 default)', () => {
  it('"tiny" or "micro" with a string bikini uses the pack at its max and spells out the shape', () => {
    const r = interpretPrompt('Sienna by the pool in a tiny pastel pink string bikini with thong bottoms.', { adultAllowed: true });
    expect(r.packs).toEqual({ string_swimsuit: 0.7 });
    expect(r.fields.outfit).toContain('very small triangle cups on thin strings');
  });
  it('a plain string bikini keeps the default and the wording as written', () => {
    const r = interpretPrompt('Sienna by the pool in a red string bikini.', { adultAllowed: true });
    expect(r.packs).toEqual({ string_swimsuit: 0.6 });
    expect(r.fields.outfit).not.toContain('very small triangle cups');
  });
});
