import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARACTER, EMPTY_FIELDS } from './defaults';
import { buildPrompt, colourDriftNegative, joinParts } from './prompt';
import { copyTraits } from './prompt';

const character = { ...DEFAULT_CHARACTER, triggerToken: 'sienna_v1', loraFilename: 'sienna_v1.safetensors' };

describe('buildPrompt', () => {
  it('puts the request first, then the trigger token and traits, with eye wording last', () => {
    const r = buildPrompt({
      fields: { ...EMPTY_FIELDS, framing: 'full body head to toe', outfit: 'red hoodie', setting: 'park path', extra: 'holding coffee' },
      character,
      siennaLock: true,
      contentMode: 'sfw',
    });
    expect(r.positive.startsWith('full body head to toe, entire body visible including feet and shoes, wide shot, camera several meters away, (red hoodie:1.1), park path, holding coffee, sienna_v1 woman, 24-year-old adult woman, ')).toBe(true);
    expect(r.positive.indexOf('taken by another person')).toBeGreaterThan(r.positive.indexOf('sienna_v1 woman'));
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

  it('with a pose guide, the outfit comes before the pose and the guide wording follows the outfit', () => {
    const fields = { ...EMPTY_FIELDS, pose: 'sitting on the edge of the bed', outfit: 'cream cable-knit sweater, light gray sweatpants', lighting: 'warm morning light' };
    const p = buildPrompt({ fields, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', poseGuide: '(both feet flat on the floor:1.15)' }).positive;
    expect(p.indexOf('sweatpants')).toBeLessThan(p.indexOf('both feet flat'));
    expect(p.indexOf('both feet flat')).toBeLessThan(p.indexOf('sitting on the edge'));
    expect(p.indexOf('sitting on the edge')).toBeLessThan(p.indexOf('warm morning light'));
    const plain = buildPrompt({ fields, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' }).positive;
    expect(plain.indexOf('sitting on the edge')).toBeLessThan(plain.indexOf('sweatpants'));
  });

  it('builds the prompt-order-tested layout with the default profile', () => {
    const r = buildPrompt({
      fields: { ...EMPTY_FIELDS, framing: 'close-up iPhone portrait', lighting: 'soft natural daylight' },
      character: DEFAULT_CHARACTER,
      siennaLock: true,
      contentMode: 'sfw',
    });
    expect(r.positive).toBe("close-up iPhone portrait, soft natural daylight, sienna_v1 woman, 24-year-old adult woman, fictional adult woman, long dark-brown wavy hair with lighter caramel ends, light freckles across nose and cheeks, (large round natural breasts:1.2), slim toned waist with defined abs, curvy hips, shot on iPhone 15 Pro, 24mm main camera, natural phone processing, realistic candid iPhone photo, natural skin texture with subtle visible pores, fine flyaway hair strands, natural facial asymmetry, slight wide-angle phone lens distortion, casual non-cinematic snapshot, imperfect slightly off-center framing, anatomically correct hands with five fingers, believable reflections, soft natural shadows, natural hazel-green eyes with realistic muted iris color"); // the lighting is described, so the profile's indoor-lighting phrase is dropped
    expect(r.negative).toBe("over-smoothed skin, airbrushed, plastic skin, waxy skin, doll-like face, cgi, 3d render, illustration, anime, over-sharpened, excessive HDR, oversaturated, perfect symmetry, beauty filter, extra fingers, fused fingers, deformed hands, extra limbs, bad anatomy, distorted teeth, warped background, duplicate objects, watermark, text, logo, lowres, small breasts, flat chest, small bust, petite chest, blurry, jpeg artifacts, studio lighting, glossy fashion editorial, cinematic color grading, different person, altered face, different face shape, different hair color, different eye color, child, teen, minor, childlike, school uniform, nsfw, nude, nudity, topless, explicit, sexual, lingerie, see-through, older woman, middle-aged, wrinkles, aged skin, mature face");
  });
});

describe('automatic full-body framing', () => {
  const FB = 'full body head to toe, entire body visible including feet and shoes, wide shot, camera several meters away';
  const run = (fields: Partial<typeof EMPTY_FIELDS>) =>
    buildPrompt({ fields: { ...EMPTY_FIELDS, ...fields }, character, siennaLock: true, contentMode: 'sfw' });

  it.each(['full body', 'full-body', 'head to toe', 'head-to-toe', 'full length', 'full-length', 'entire body'])('triggers on "%s" and goes first', (phrase) => {
    const r = run({ extra: `Sienna walking in the park, ${phrase} iPhone photo`, outfit: 'red top' });
    expect(r.positive.startsWith(FB + ', ')).toBe(true);
    expect(r.positive.split(FB)).toHaveLength(2);
  });

  it.each(['close-up', 'portrait', 'waist-up', 'chest-up', 'half-body', 'half body'])('does not trigger for "%s"', (phrase) => {
    const r = run({ extra: `${phrase} photo of Sienna by a window` });
    expect(r.positive).not.toContain(FB);
  });

  it('does not trigger without a full-body request', () => {
    expect(run({ extra: 'Sienna in her living room at night' }).positive).not.toContain(FB);
  });

  it('respects the tighter instruction when framing conflicts, with a warning', () => {
    const r = run({ extra: 'full-body photo, close-up of her face' });
    expect(r.positive).not.toContain(FB);
    expect(r.warnings.some((w) => w.includes('full-body'))).toBe(true);
  });

  it('normal full-body: third-person camera, no close-camera realism, anti-crop negative', () => {
    const r = run({ extra: 'Sienna walking down a sidewalk, candid full-body iPhone photo' });
    expect(r.positive).toContain('realistic iPhone photo taken by another person from several meters away, natural phone-camera processing');
    expect(r.positive).not.toContain(character.defaultCameraStyle);
    expect(r.positive).not.toContain('wide-angle phone lens distortion');
    expect(r.positive).toContain('candid full-body iPhone photo');
    expect(r.negative).toContain("arm's-length selfie, close-up crop, cropped legs, cropped feet");
  });

  it('full-body mirror selfie: mirror composition, no selfie negative, no phone-camera line', () => {
    const r = run({ extra: 'Sienna taking a full-body mirror selfie in her bedroom, phone visible in the mirror' });
    expect(r.positive.startsWith('full-length mirror selfie, entire reflected body visible head to toe including feet, phone visible in hand, ')).toBe(true);
    expect(r.positive).not.toContain(FB);
    expect(r.positive).not.toContain(character.defaultCameraStyle);
    expect(r.positive).not.toContain('taken by another person');
    expect(r.positive).not.toContain('wide-angle phone lens distortion');
    expect(r.negative).not.toMatch(/selfie|cropped/);
  });

  it("keeps the user's own camera wording and the default camera for other shots", () => {
    expect(run({ extra: 'full body photo', camera: 'shot on a 50mm lens' }).positive).toContain('shot on a 50mm lens');
    const seated = run({ extra: 'sitting on a couch, candid iPhone photo' });
    expect(seated.positive).toContain(character.defaultCameraStyle);
    expect(seated.positive).toContain('wide-angle phone lens distortion');
    expect(seated.negative).not.toContain('cropped feet');
  });

  it('lets the Framing field decide', () => {
    expect(run({ framing: 'waist-up shot', extra: 'full body outfit check' }).positive).not.toContain(FB);
    const weak = run({ framing: 'full body photo' });
    expect(weak.positive.startsWith(FB + ', full body photo, ')).toBe(true);
    const strong = run({ framing: 'full body, entire body visible, feet on the floor' });
    expect(strong.positive).not.toContain(FB);
    expect(strong.positive.startsWith('full body, entire body visible, feet on the floor, ')).toBe(true);
  });
});

describe('rear-view requests', () => {
  const rearFields = { ...EMPTY_FIELDS, framing: 'Full-body rear-view photograph, head to feet visible', pose: 'standing at the shoreline with her back fully toward the camera', outfit: 'white string bikini' };
  it('puts weighted rear wording first, turns her face away and drops the eye wording', () => {
    const r = buildPrompt({ fields: rearFields, character, siennaLock: true, contentMode: 'sfw' });
    expect(r.positive.startsWith('(view from behind:1.3), (back view:1.3), (head facing away from the camera:1.2), full body head to toe')).toBe(true);
    expect(r.positive).not.toMatch(/hazel-green|iris/);
    expect(r.negative).toContain('(looking at viewer:1.3), (facing the camera:1.3), (front view:1.3)');
  });
  it('a looking-back pose keeps her face and eyes', () => {
    const r = buildPrompt({ fields: { ...rearFields, pose: 'from behind, looking back over her shoulder' }, character, siennaLock: true, contentMode: 'sfw' });
    expect(r.positive.startsWith('(view from behind:1.3), (back view:1.3), full body')).toBe(true);
    expect(r.positive).toContain('hazel-green');
    expect(r.negative).toContain('(front view:1.2)');
    expect(r.negative).not.toContain('looking at viewer');
  });
  it('front-facing requests are unchanged', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, pose: 'standing facing the camera', outfit: 'red dress' }, character, siennaLock: true, contentMode: 'sfw' });
    expect(r.positive).not.toContain('view from behind');
    expect(r.negative).not.toContain('front view');
  });
});

describe('profile defaults never contradict the request', () => {
  const b = (f: Partial<typeof EMPTY_FIELDS>) => buildPrompt({ fields: { ...EMPTY_FIELDS, ...f }, character, siennaLock: true, contentMode: 'sfw' }).positive;
  it('keeps the indoor-lighting phrase only for an indoor scene with no lighting described', () => {
    expect(b({ setting: 'cosy bedroom' })).toContain('believable ambient indoor lighting');
    expect(b({ setting: 'sunny beach at the shoreline' })).not.toContain('indoor lighting');
    expect(b({ setting: 'kitchen', lighting: 'natural morning light from the window' })).not.toContain('indoor lighting');
  });
  it('drops the phone-camera phrases when another camera is asked for', () => {
    const p = b({ camera: 'professional studio photo shoot, DSLR, 85mm lens' });
    expect(p).toContain('DSLR');
    expect(p).not.toMatch(/iPhone|phone lens/);
    expect(b({ camera: 'iPhone 16 selfie' })).toContain('realistic candid iPhone photo');
  });
});

describe('joinParts', () => {
  it('dedupes and drops empties', () => {
    expect(joinParts(['a', '', ' A ', 'b', null])).toBe('a, b');
  });
});

describe('keeping the top on', () => {
  const base = { outfit: '', pose: '', bodyPresentation: '', expression: '', setting: '', lighting: '', camera: '', framing: '', realism: '', extra: '', avoid: '' };
  const build = (fields: Partial<typeof base>, contentMode: 'sfw' | 'adult' = 'sfw') =>
    buildPrompt({ fields: { ...base, ...fields }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode });

  it('adds a weighted keep-top negative when the outfit has a top, in both modes', () => {
    expect(build({ outfit: 'black micro string bikini' }).negative).toContain('(topless, bare breasts, exposed nipples:1.3)');
    expect(build({ outfit: 'white lace bra and panties' }, 'adult').negative).toContain('(topless, bare breasts, exposed nipples:1.3)');
  });

  it('skips it when there is no top or the outfit asks for none', () => {
    expect(build({ outfit: 'denim shorts' }).negative).not.toContain('exposed nipples:1.3');
    expect(build({ outfit: 'topless, denim shorts' }, 'adult').negative).not.toContain('exposed nipples:1.3');
  });

  it('lets coverage words through Avoid even though "breasts" is one of her traits', () => {
    const r = build({ outfit: 'bikini', avoid: 'bare breasts, small breasts' });
    expect(r.negative).toContain('bare breasts');
    expect(r.warnings.some((w) => w.includes('bare breasts'))).toBe(false);
  });
});

describe('pose and colour emphasis', () => {
  const base = { outfit: '', pose: '', bodyPresentation: '', expression: '', setting: '', lighting: '', camera: '', framing: '', realism: '', extra: '', avoid: '' };
  it('weights coloured outfit items 1.1, leaves the pose and already-weighted text alone', () => {
    const r = buildPrompt({ fields: { ...base, pose: 'lying on her stomach, propped on her elbows', outfit: 'red string bikini, gold anklet, (black:1.3) sandals' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' });
    expect(r.positive).toContain('lying on her stomach, propped on her elbows, (red string bikini:1.1), (gold anklet:1.1), (black:1.3) sandals');
    const w = buildPrompt({ fields: { ...base, pose: '(sitting:1.5)', outfit: 'string bikini' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw' });
    expect(w.positive).toContain('(sitting:1.5), string bikini');
  });
});

describe('colourDriftNegative', () => {
  it('avoids the drift colours the outfit did not ask for', () => {
    expect(colourDriftNegative('fitted red bodycon dress')).toBe('olive green clothing, sage green clothing, brown clothing, beige clothing');
    expect(colourDriftNegative('olive green cargo pants, white tank top')).toBe('brown clothing, beige clothing');
    expect(colourDriftNegative('beige trench coat')).toBe('olive green clothing, sage green clothing, brown clothing');
  });

  it('adds nothing when the outfit names no colour', () => {
    expect(colourDriftNegative('cozy knit sweater')).toBe('');
    expect(colourDriftNegative('completely nude')).toBe('');
  });
});

describe('close framing (Copy Photo)', () => {
  const run = (fields: Partial<typeof EMPTY_FIELDS>, closeFrame = true) =>
    buildPrompt({ fields: { ...EMPTY_FIELDS, ...fields }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', closeFrame });
  it('keeps only what is in frame for a chest-up shot', () => {
    const r = run({ framing: 'chest up', outfit: 'purple string triangle bikini top, small cups, string thong bottoms' });
    expect(r.positive.startsWith('(close shot from the chest up, cropped below the chest:1.3), chest up')).toBe(true);
    expect(r.positive).not.toMatch(/curvy hips|defined abs|thong bottoms/);
    expect(r.positive).toContain('(large round natural breasts:1.2)');
    expect(r.positive).toContain('purple');
    expect(r.negative).toContain('full body, wide shot, legs, thighs');
  });
  it('keeps the waist for a waist-up shot, not the hips', () => {
    const r = run({ framing: 'waist up' });
    expect(r.positive).toContain('slim toned waist');
    expect(r.positive).not.toContain('curvy hips');
  });
  it('changes nothing when off, or for wide shots', () => {
    expect(run({ framing: 'chest up' }, false).positive).toContain('curvy hips');
    expect(run({ framing: 'knee-up shot' }).positive).toContain('curvy hips');
  });
});

describe('copy mode (Copy Photo)', () => {
  it('source-locked copies add no wording that moves the photo cups', () => {
    const f = { ...EMPTY_FIELDS, outfit: 'tiny white micro string bikini top, cups toward the outer sides' };
    const plain = buildPrompt({ fields: f, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true }).positive;
    const locked = buildPrompt({ fields: f, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true, sourceLock: true }).positive;
    expect(plain).toMatch(/centred over the nipple/);
    expect(locked).not.toMatch(/centred over the nipple/);
    expect(locked).toMatch(/cups toward the outer sides/);
    const neg = buildPrompt({ fields: f, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true, sourceLock: true }).negative;
    expect(neg).toMatch(/auburn hair/);
    expect(neg).toMatch(/jet-black hair/);
    // her own hair colour, weighted, from her profile, with cool ends (caramel drew copper lengths, 4 Nov)
    expect(locked).toMatch(/\(long dark-brown wavy hair with lighter soft light-brown ends:1\.25\)/);
    expect(locked).not.toMatch(/caramel/);
    expect(neg).toMatch(/copper hair/);
    expect(plain).not.toMatch(/caramel ends:1\.25/);
    expect(buildPrompt({ fields: f, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true }).negative).not.toMatch(/auburn hair/);
  });
  it('takes the photo’s hairstyle and bust size over her profile defaults, keeping her hair colour', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, bodyPresentation: 'hair pulled back into a high messy top-knot bun, very large breasts', expression: 'neutral, lips parted mid-sentence' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true });
    expect(r.positive).toContain('dark-brown hair with lighter caramel ends');
    expect(r.positive).not.toContain('long dark-brown wavy hair');
    expect(r.positive).not.toContain('(large round natural breasts:1.2)');
    expect(r.positive).toContain('(neutral, lips parted mid-sentence:1.25)');
  });
  it('changes nothing about her outside copy mode', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, bodyPresentation: 'hair in a bun' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult' });
    expect(r.positive).toContain('long dark-brown wavy hair');
  });
});

describe('copy mode bust', () => {
  it('drops the profile bust when the photo describes one, and its weight otherwise', () => {
    const run = (bodyPresentation: string) => buildPrompt({ fields: { ...EMPTY_FIELDS, bodyPresentation }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true }).positive;
    expect(run('very large natural breasts set wide apart')).not.toContain('large round natural breasts');
    expect(run('damp skin')).toContain('large round natural breasts');
    expect(run('damp skin')).not.toContain('(large round natural breasts:1.2)');
  });
});

describe('Avoid keeps bust-shape words under Sienna Lock', () => {
  it('lets "breasts pressed together" and "pushed-up breasts" through, still blocks "large breasts"', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, avoid: 'breasts pressed together, pushed-up breasts, large breasts' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult' });
    expect(r.negative).toContain('breasts pressed together');
    expect(r.negative).toContain('pushed-up breasts');
    expect(r.negative).not.toMatch(/(^|, )large breasts/);
  });
});

describe('copy mode hairstyle', () => {
  it('weights an updo and keeps her hair from falling loose', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, bodyPresentation: 'hair slicked back into a high neat top-knot bun, damp skin' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true });
    expect(r.positive).toContain('(hair slicked back into a high neat top-knot bun:1.3)');
    expect(r.negative).toContain('long loose hair down');
  });
  it('leaves hair worn down alone', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, bodyPresentation: 'hair down and wavy' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true });
    expect(r.negative).not.toContain('long loose hair down');
  });
});

describe('copy mode hands', () => {
  const run = (pose: string) => buildPrompt({ fields: { ...EMPTY_FIELDS, pose }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true }).negative;
  it('keeps invented objects out of her hands unless the photo has her holding something', () => {
    expect(run('arm resting on the tub edge')).toContain('holding a plant');
    expect(run('holding a phone at arm’s length')).not.toContain('holding a plant');
  });
});

describe('copy mode details', () => {
  const run = (f: Partial<typeof EMPTY_FIELDS>) => buildPrompt({ fields: { ...EMPTY_FIELDS, ...f }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true });
  it('keeps a neutral talking face from smiling', () => {
    const r = run({ expression: 'neutral, lips parted mid-sentence' });
    expect(r.positive).toContain('(neutral, lips parted mid-sentence:1.25)');
    expect(r.negative).toContain('smiling');
    expect(run({ expression: 'relaxed smile' }).negative).not.toContain('grin');
  });
  it('keeps out accessories and strap colours the photo doesn’t have', () => {
    const r = run({ outfit: 'white triangle bikini top, thin white strings' });
    expect(r.negative).toContain('scrunchie on her arm');
    expect(r.negative).toContain('black straps');
    expect(r.negative).not.toContain('white straps');
    expect(run({ outfit: 'purple bikini top, small gold rings joining strings to cups, gold bracelet' }).negative).not.toContain('bangles');
  });
});

describe('copy mode topless', () => {
  it('keeps a top from being invented on a topless photo', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'white lace thong, topless from behind' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true });
    expect(r.negative).toContain('strap across her back');
  });
});

describe('copy mode bust height', () => {
  it('keeps the low-bust avoid words under Sienna Lock', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'purple bikini top', avoid: 'perky breasts sitting high on the chest, high round breasts' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true });
    expect(r.negative).toContain('perky breasts sitting high on the chest');
    expect(r.negative).toContain('high round breasts');
  });
});

describe('copy mode colour drift', () => {
  it('avoids the colour a purple garment drifts to, and invented hoops', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'purple bikini top' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true });
    expect(r.negative).toContain('royal blue bikini');
    expect(r.negative).toContain('hoop earrings');
    expect(r.positive).toContain('her natural light-tan skin');
  });
});

describe('copy mode underboob', () => {
  it('asks for the breasts to hang below the under-string when the photo shows it', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'yellow micro bikini top, inner and outer curves and undersides largely bare' }, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'adult', copy: true });
    expect(r.positive).toContain('hanging below the thin under-bust string');
  });
});

describe('copyTraits for a source-locked copy', () => {
  it('drops her body-shape traits but keeps hair, face and freckles', () => {
    const t = 'dark-brown hair with lighter caramel ends, light freckles across nose and cheeks, slim toned waist with defined abs, curvy hips';
    expect(copyTraits(t, 'a bikini', true)).toBe('dark-brown hair with lighter caramel ends, light freckles across nose and cheeks');
    expect(copyTraits(t, 'a bikini')).toContain('defined abs');
  });
});

describe('coolHair', () => {
  it('turns caramel ends into soft light-brown ends', async () => {
    const { coolHair } = await import('./prompt');
    expect(coolHair('long dark-brown wavy hair with lighter caramel ends')).toBe('long dark-brown wavy hair with lighter soft light-brown ends');
    expect(coolHair('dark-brown hair')).toBe('dark-brown hair');
  });
});
