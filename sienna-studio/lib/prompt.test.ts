import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARACTER, EMPTY_FIELDS } from './defaults';
import { buildPrompt, joinParts } from './prompt';

const character = { ...DEFAULT_CHARACTER, triggerToken: 'sienna_v1', loraFilename: 'sienna_v1.safetensors' };

describe('buildPrompt', () => {
  it('puts the request first, then the trigger token and traits, with eye wording last', () => {
    const r = buildPrompt({
      fields: { ...EMPTY_FIELDS, framing: 'full body head to toe', outfit: 'red hoodie', setting: 'park path', extra: 'holding coffee' },
      character,
      siennaLock: true,
      contentMode: 'sfw',
    });
    expect(r.positive.startsWith('full body head to toe, red hoodie, park path, holding coffee, sienna_v1 woman, 24-year-old adult woman, ')).toBe(true);
    expect(r.positive.indexOf(character.defaultCameraStyle)).toBeGreaterThan(r.positive.indexOf('sienna_v1 woman'));
    expect(r.positive.endsWith(', natural hazel-green eyes with realistic muted iris color')).toBe(true);
    expect(r.positive.match(/hazel-green|iris/g)).toHaveLength(2);
  });

  it('moves custom eye wording to the end and upgrades the old default wording', () => {
    const custom = buildPrompt({ fields: EMPTY_FIELDS, character: { ...character, appearanceTraits: 'fictional adult woman, grey eyes, freckles' }, siennaLock: true, contentMode: 'sfw' });
    expect(custom.positive.endsWith(', grey eyes')).toBe(true);
    expect(custom.positive).toContain('fictional adult woman, freckles');
    const legacy = buildPrompt({
      fields: EMPTY_FIELDS,
      character: { ...character, appearanceTraits: 'fictional adult woman, natural light hazel-green eyes, muted realistic iris color' },
      siennaLock: true,
      contentMode: 'sfw',
    });
    expect(legacy.positive.endsWith(', natural hazel-green eyes with realistic muted iris color')).toBe(true);
    expect(legacy.positive).not.toContain('natural light hazel-green');
  });

  it('removes identity edits under Sienna Lock and warns', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'platinum blonde hair, tank top' }, character, siennaLock: true, contentMode: 'sfw' });
    expect(r.positive).not.toMatch(/blonde/);
    expect(r.positive).toContain('tank top');
    expect(r.warnings.some((w) => w.includes('blonde'))).toBe(true);
  });

  it('does not inject identity when unlocked', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'blonde hair' }, character, siennaLock: false, contentMode: 'sfw' });
    expect(r.positive).not.toContain('sienna_v1');
    expect(r.positive).toContain('blonde hair');
    expect(r.positive.startsWith('blonde hair, adult woman')).toBe(true);
  });

  it('always includes adult-only negatives; SFW adds nsfw negatives', () => {
    const sfw = buildPrompt({ fields: EMPTY_FIELDS, character, siennaLock: true, contentMode: 'sfw' });
    const adult = buildPrompt({ fields: EMPTY_FIELDS, character, siennaLock: true, contentMode: 'adult' });
    expect(sfw.negative).toMatch(/\bteen\b/);
    expect(adult.negative).toMatch(/\bteen\b/);
    expect(sfw.negative).toMatch(/nsfw/);
    expect(adult.negative).not.toMatch(/nsfw/);
  });

  it('drops the anti-studio negative only when studio lighting is requested', () => {
    const casual = buildPrompt({ fields: EMPTY_FIELDS, character, siennaLock: true, contentMode: 'sfw' });
    const studio = buildPrompt({ fields: { ...EMPTY_FIELDS, lighting: 'studio softbox' }, character, siennaLock: true, contentMode: 'sfw' });
    expect(casual.negative).toMatch(/studio lighting/);
    expect(studio.negative).not.toMatch(/studio lighting/);
  });

  it('reports hard blocks', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'school girl uniform' }, character, siennaLock: true, contentMode: 'sfw' });
    expect(r.blocked.length).toBeGreaterThan(0);
  });

  it('clamps age to the adult minimum', () => {
    const r = buildPrompt({ fields: EMPTY_FIELDS, character: { ...character, age: 12 }, siennaLock: true, contentMode: 'sfw' });
    expect(r.positive).toContain('21-year-old adult woman');
  });
  it('does not double "woman" when the token already includes it', () => {
    const r = buildPrompt({ fields: EMPTY_FIELDS, character: { ...character, triggerToken: 'sienna_v1 woman' }, siennaLock: true, contentMode: 'sfw' });
    expect(r.positive.startsWith('sienna_v1 woman, 24-year-old')).toBe(true);
  });

  it('adds the age-drift negative only under Sienna Lock, and never "young-looking"', () => {
    const locked = buildPrompt({ fields: EMPTY_FIELDS, character, siennaLock: true, contentMode: 'sfw' });
    const unlocked = buildPrompt({ fields: EMPTY_FIELDS, character, siennaLock: false, contentMode: 'sfw' });
    expect(locked.negative).toMatch(/middle-aged/);
    expect(unlocked.negative).not.toMatch(/middle-aged/);
    expect(locked.negative).not.toMatch(/young-looking/);
  });

  it('builds the prompt-order-tested layout with the default profile', () => {
    const r = buildPrompt({
      fields: { ...EMPTY_FIELDS, framing: 'close-up iPhone portrait', lighting: 'soft natural daylight' },
      character: DEFAULT_CHARACTER,
      siennaLock: true,
      contentMode: 'sfw',
    });
    expect(r.positive).toBe("close-up iPhone portrait, soft natural daylight, sienna_v1 woman, 24-year-old adult woman, fictional adult woman, long dark-brown wavy hair with lighter caramel ends, light freckles across nose and cheeks, shot on iPhone 15 Pro, 24mm main camera, natural phone processing, realistic candid iPhone photo, natural skin texture with subtle visible pores, fine flyaway hair strands, natural facial asymmetry, believable ambient indoor lighting, slight wide-angle phone lens distortion, casual non-cinematic snapshot, imperfect slightly off-center framing, anatomically correct hands with five fingers, believable reflections, soft natural shadows, natural hazel-green eyes with realistic muted iris color");
    expect(r.negative).toBe("over-smoothed skin, airbrushed, plastic skin, waxy skin, doll-like face, cgi, 3d render, illustration, anime, over-sharpened, excessive HDR, oversaturated, perfect symmetry, beauty filter, extra fingers, fused fingers, deformed hands, extra limbs, bad anatomy, distorted teeth, warped background, duplicate objects, watermark, text, logo, lowres, blurry, jpeg artifacts, studio lighting, glossy fashion editorial, cinematic color grading, different person, altered face, different face shape, different hair color, different eye color, child, teen, minor, childlike, school uniform, nsfw, nude, nudity, topless, explicit, sexual, lingerie, see-through, older woman, middle-aged, wrinkles, aged skin, mature face");
  });
});

describe('joinParts', () => {
  it('dedupes and drops empties', () => {
    expect(joinParts(['a', '', ' A ', 'b', null])).toBe('a, b');
  });
});
