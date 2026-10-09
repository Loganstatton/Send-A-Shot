import { describe, expect, it } from 'vitest';
import { approxTokens, promptAdvice } from './prompt-advice';
import { buildPrompt } from './prompt';
import { DEFAULT_CHARACTER, EMPTY_FIELDS } from './defaults';

// The live failed case: the generator prompt and outfit exactly as sent.
const LIVE_PROMPT = "full-length mirror selfie, entire reflected body visible from head to toe including feet and shoes, tall mirror fully framing her body, phone visible in hand, camera far enough from the mirror to capture the entire reflection, mirror frame visible, standing at the sink hands above her head, taking a mirror selfie, showing head to toe, Black minimalist micro string bikini. Very small opaque triangular bikini cups with narrow fabric panels, thin black halter-neck straps, and a single thin underbust string. Matching black low-rise string bikini bottoms with a narrow front panel, high-cut sides, and adjustable ties at both hips. No beige fabric, no wide bikini cups, no thick straps, no additional fabric panels. Accurate black swimwear color, realistic fabric tension, natural folds, and authentic skin compression beneath the strings, soft natural expression, small apartment bathroom, tiled wall, toiletries on the counter, slightly fogged mirror edges, overhead vanity light, slightly warm, realistic bathroom reflections, sienna_v1 woman, 24-year-old adult woman, fictional adult woman, long dark-brown wavy hair with lighter caramel ends, light freckles across nose and cheeks, iPhone rear camera photographed in the mirror, realistic candid iPhone photo, natural skin texture with subtle visible pores, fine flyaway hair strands, natural facial asymmetry, believable ambient indoor lighting, casual non-cinematic snapshot, imperfect slightly off-center framing, anatomically correct hands with five fingers, believable reflections, soft natural shadows, Photorealistic, unedited iPhone photograph with natural skin texture, visible pores, subtle peach fuzz, realistic freckles, tiny skin imperfections, faint stretch marks, slight unevenness in skin tone, and natural skin folds around the waist and hips. Anatomically realistic body proportions, natural breast shape, subtle skin compression beneath bikini straps, realistic fabric tension, slight where the fabric gathers, and thin strings resting naturally against the skin. Soft ambient lighting, authentic shadows, realistic fabric texture, no artificial smoothing, no exaggerated curves, no plastic-looking skin, and no CGI appearance., natural hazel-green eyes with realistic muted iris color";
const LIVE_OUTFIT = "Black minimalist micro string bikini. Very small opaque triangular bikini cups with narrow fabric panels, thin black halter-neck straps, and a single thin underbust string. Matching black low-rise string bikini bottoms with a narrow front panel, high-cut sides, and adjustable ties at both hips. No beige fabric, no wide bikini cups, no thick straps, no additional fabric panels. Accurate black swimwear color, realistic fabric tension, natural folds, and authentic skin compression beneath the strings";

describe('promptAdvice', () => {
  it('flags everything that weakened the live micro-bikini prompt', () => {
    const ids = promptAdvice({ positive: LIVE_PROMPT, outfit: LIVE_OUTFIT }).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['long', 'outfit-long', 'negation', 'skin']));
    expect(approxTokens(LIVE_PROMPT)).toBeGreaterThan(400);
  });

  it('is quiet for a short, front-loaded outfit', () => {
    const outfit = 'black micro string bikini, tiny triangle cups, thin black string halter straps, string side ties';
    expect(promptAdvice({ positive: `full body shot, ${outfit}, small bathroom, sienna woman`, outfit, avoid: 'wide cups, thick straps' })).toEqual([]);
  });

  it('buried outfit, size and colour conflicts, avoid clashes', () => {
    const filler = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const ids = (p: string, o: string, a = '') => promptAdvice({ positive: p, outfit: o, avoid: a }).map((x) => x.id);
    expect(ids(`${filler}, red dress`, 'red dress')).toContain('buried');
    expect(ids('micro bikini with wide cups', 'micro bikini with wide cups')).toContain('size-conflict');
    expect(ids('micro bikini, no wide cups', 'micro bikini, no wide cups')).not.toContain('size-conflict');
    expect(ids('black, white and red striped dress', 'black, white and red striped dress')).toContain('colours');
    expect(ids('black bikini with thick straps', 'black bikini with thick straps', 'thick straps')).toContain('avoid-conflict');
  });

  it('Edit Outfit: "no …" phrases are reported as moved, not as a mistake', () => {
    const a = promptAdvice({ positive: 'black bikini. No wide cups.', outfit: 'black bikini. No wide cups.', negationsMoved: true });
    expect(a.find((x) => x.id === 'negation')?.text).toMatch(/moved to the editor/);
  });
});

describe('Avoid field (Create)', () => {
  it('goes to the negative prompt only, and Sienna Lock keeps identity terms out of it', () => {
    const fields = { ...EMPTY_FIELDS, outfit: 'black micro bikini', avoid: 'no wide cups, thick straps\nfreckles' };
    const b = buildPrompt({ fields, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' });
    expect(b.negative).toContain('wide cups, thick straps');
    expect(b.positive).not.toContain('wide cups');
    expect(b.negative).not.toMatch(/\bno wide/);
    expect(b.negative).not.toMatch(/freckles$/);
    expect(b.warnings.join(' ')).toMatch(/removed “freckles” from Avoid/);
    const off = buildPrompt({ fields, character: DEFAULT_CHARACTER, siennaLock: false, contentMode: 'sfw' });
    expect(off.negative).toContain('wide cups');
  });

  it('an empty Avoid leaves the negative prompt exactly as before', () => {
    const base = { ...EMPTY_FIELDS, outfit: 'red dress' };
    const a = buildPrompt({ fields: base, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' });
    const b = buildPrompt({ fields: { ...base, avoid: '' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' });
    const { avoid: _omit, ...noAvoid } = base as any;
    const c = buildPrompt({ fields: noAvoid, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' });
    expect(b.negative).toBe(a.negative);
    expect(c.negative).toBe(a.negative);
  });
});
