import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  CHEEKY_FIT,
  CHEEKY_NEGATIVE,
  colourGuardNegative,
  COVER_STOMACH_NEGATIVE,
  KEEP_BOTTOM_NEGATIVE,
  KNEE_UP_FRAMING,
  KNEE_UP_NEGATIVE,
  KNOT_NEGATIVE,
  outfitHasBottom,
  SHORT_SHORTS_NEGATIVE,
  shortsParts,
  splitGarments,
  TANK_FIT,
  TINY_SHORTS_FIT,
} from './prompt';
import { DEFAULT_CHARACTER, EMPTY_FIELDS } from './defaults';
import { FIXES, fixesFromEnv, type Fix } from './fixes';
import { framingLevels, kneeUpRequest, withoutThighUp } from './framing';
import { KNEE_EDGE, kneeFramingOk, type BodyFrame } from './body-frame';
import { checkRules, checkUser, CHEEKY_RULE, COVERAGE_RULE, FULL_BODY_FRAMING_RULE, KNEE_FRAMING_RULE } from './ai-prompts';
import { packFitsOutfit, packsForDescription, resolvePackConflicts, UNDERBOOB_TANK_RE } from './style-packs';
import { POSE_PRESETS } from './pose-presets';
import type { PromptFields } from './types';

// The fields the AI reader wrote for the revealing benchmark (22 Oct, seed 101).
const bench = (outfit: string, extra: Partial<PromptFields> = {}): PromptFields => ({
  ...EMPTY_FIELDS,
  outfit,
  pose: 'standing, facing camera, arms relaxed at sides, looking at camera',
  expression: 'soft smile, looking at camera',
  setting: 'sunny pool deck, swimming pool',
  lighting: 'bright afternoon sunlight',
  camera: 'casual iPhone photo taken by a friend, a few steps away, camera at chest height',
  framing: 'head to knees, three-quarter shot',
  ...extra,
});
const OUTFITS = {
  B1: 'fitted black low-cut tank top showing cleavage, blue jeans',
  B3: 'red fitted scoop neck top, low neckline, cleavage, blue jeans',
  C2: 'black underboob tank top cut high, blue jeans',
  D3: 'black micro string bikini top, black micro string bikini bottoms, very small triangle cups on thin strings, string thong bottoms',
  E1: 'white fitted tank top, blue very short frayed denim shorts',
  E2: 'grey cotton cami, pink cheeky pajama shorts',
  E3: 'black sports bra, black tiny low-coverage running shorts',
  E4: 'white crop top, black booty shorts, lower curve of buttocks visible below shorts hems',
};
const build = (f: PromptFields, fixes: Fix[] = [], mode: 'sfw' | 'adult' = 'sfw', coverStomach: boolean | ('tee' | 'tank' | 'buttonup')[] = ['tank', 'buttonup']) =>
  buildPrompt({ fields: f, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: mode, coverStomach, fixes });

describe('fix switches', () => {
  it('SIENNA_FIXES: a comma list of known fixes, true = all, anything else ignored', () => {
    expect(fixesFromEnv(undefined)).toEqual([]);
    expect(fixesFromEnv('keepbottom, framing,bogus')).toEqual(['keepbottom', 'framing']);
    expect(fixesFromEnv('true')).toEqual([...FIXES]);
  });
  it('with no fixes on, every benchmark prompt is exactly what production sends today', () => {
    for (const outfit of Object.values(OUTFITS)) {
      const f = bench(outfit);
      const prod = buildPrompt({ fields: f, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', coverStomach: ['tank', 'buttonup'] });
      expect(build(f)).toEqual(prod);
      expect(prod.negative).not.toContain(KEEP_BOTTOM_NEGATIVE);
      expect(prod.positive).not.toContain(KNEE_UP_FRAMING);
      expect(prod.positive).toContain('three-quarter shot');
    }
  });
});

describe('pack stacking (D3: micro bikini + string swimsuit)', () => {
  it('the micro pack never stacks on the string swimsuit pack, however the packs were chosen', () => {
    expect(resolvePackConflicts({ micro_bikini: 0.85, string_swimsuit: 0.7 })).toEqual({ packs: { string_swimsuit: 0.7 }, dropped: ['micro_bikini'] });
    expect(resolvePackConflicts({ micro_bikini: 0.85, natural_skin: 0.3 })).toEqual({ packs: { micro_bikini: 0.85, natural_skin: 0.3 }, dropped: [] });
    expect(resolvePackConflicts({ french_lace: 0.6, lace_bodysuit: 0.6 }).packs).toEqual({ lace_bodysuit: 0.6 });
    expect(resolvePackConflicts({ micro_bikini: 0, string_swimsuit: 0.6 }).dropped).toEqual([]);
  });
  it('a micro string bikini gets the string swimsuit pack alone, at its tiny-string strength', () => {
    expect(packsForDescription({ outfit: OUTFITS.D3 }, 'adult')).toEqual({ string_swimsuit: 0.7 });
    expect(packsForDescription({ outfit: 'black micro bikini top, black micro bikini bottoms' }, 'sfw')).toEqual({ micro_bikini: 0.85 });
  });
});

describe('keepbottom: adult mode keeps the lower-body safeguard', () => {
  it('an outfit that covers her lower body gets the coverage negative in either mode', () => {
    const adult = build(bench(OUTFITS.D3), ['keepbottom'], 'adult');
    expect(adult.negative).toContain(KEEP_BOTTOM_NEGATIVE);
    expect(adult.negative).not.toContain('nsfw'); // adult mode itself is unchanged
    expect(build(bench(OUTFITS.E3), ['keepbottom']).negative).toContain(KEEP_BOTTOM_NEGATIVE);
  });
  it('never for a request without bottoms or an explicitly nude one', () => {
    expect(outfitHasBottom('completely nude')).toBe(false);
    expect(outfitHasBottom('white tank top, bottomless')).toBe(false);
    expect(outfitHasBottom('black string bikini')).toBe(true);
    expect(build(bench('completely nude'), ['keepbottom'], 'adult').negative).not.toContain(KEEP_BOTTOM_NEGATIVE);
  });
});

describe('framing: head to knees', () => {
  it('is a knee-up request, and "three-quarter shot" next to it is dropped as a contradiction', () => {
    expect(kneeUpRequest('head to knees, three-quarter shot')).toBe(true);
    expect(kneeUpRequest('full body, head to toe')).toBe(false);
    expect(kneeUpRequest('waist up')).toBe(false);
    expect(framingLevels('head to knees')).toEqual(['knee-up']);
    expect(withoutThighUp('head to knees, three-quarter shot')).toBe('head to knees');
    expect(withoutThighUp('three-quarter shot')).toBe('three-quarter shot');
  });
  it('with the fix, knee-up wording goes up front and the thigh crop goes in the negative', () => {
    const b = build(bench(OUTFITS.B1), ['framing']);
    expect(b.positive.startsWith(KNEE_UP_FRAMING)).toBe(true);
    expect(b.positive).not.toContain('three-quarter shot');
    expect(b.negative).toContain(KNEE_UP_NEGATIVE);
    const full = build(bench(OUTFITS.B1, { framing: 'full body, head to toe' }), ['framing']);
    expect(full.positive).not.toContain(KNEE_UP_FRAMING);
  });
  it('the body check needs her head and a knee clear of the bottom edge', () => {
    const H = 1216;
    const body = (knee: number | null, head = true): BodyFrame => ({
      found: true, head, feet: false,
      joints: Array.from({ length: 14 }, (_, i) => (i === 9 || i === 12 ? (knee === null ? null : [400, knee]) : [400, 100])) as BodyFrame['joints'],
    });
    expect(kneeFramingOk(body(1100), H)).toEqual({ ok: true });
    expect(kneeFramingOk(body(null), H)).toEqual({ ok: false, miss: 'her knees' });
    expect(kneeFramingOk(body(Math.ceil(KNEE_EDGE * H) + 5), H)).toEqual({ ok: false, miss: 'her knees' });
    expect(kneeFramingOk(body(1100, false), H)).toEqual({ ok: false, miss: 'her head' });
    expect(kneeFramingOk({ found: false, head: false, feet: false }, H)).toBeUndefined();
  });
});

describe('colour: each garment keeps its own colour', () => {
  it('the jeans’ blue is kept off the top and the top’s colour off the jeans (B3, C2)', () => {
    expect(colourGuardNegative(OUTFITS.B3)).toBe('(blue top, navy top, denim top, red jeans:1.2)');
    expect(colourGuardNegative(OUTFITS.C2)).toBe('(blue tank top, navy tank top, denim tank top, black jeans:1.2)');
    expect(colourGuardNegative('(red fitted scoop neck top:1.1), (blue jeans:1.1)')).toBe('(blue top, navy top, denim top, red jeans:1.2)');
  });
  it('nothing when the colours match, one is missing, or there is one garment', () => {
    expect(colourGuardNegative('navy blouse, blue jeans')).toBe('');
    expect(colourGuardNegative('fitted scoop neck top, blue jeans')).toBe('');
    expect(colourGuardNegative('red bodycon dress')).toBe('');
  });
  it('is added to the negative only with the fix', () => {
    expect(build(bench(OUTFITS.B3), ['colour']).negative).toContain('(blue top, navy top, denim top, red jeans:1.2)');
    expect(build(bench(OUTFITS.B3)).negative).not.toContain('navy top');
  });
  it('garmentsplit: each garment with its own descriptors', () => {
    expect(splitGarments('(red fitted scoop neck top:1.1), low neckline, cleavage, (blue jeans:1.1)')).toEqual(['(red fitted scoop neck top:1.1), low neckline, cleavage', '(blue jeans:1.1)']);
    expect(splitGarments('(red bodycon dress:1.1)')).toEqual(['(red bodycon dress:1.1)']);
  });
});

describe('shorts: ordinary, short and cheeky are different requests', () => {
  it('ordinary shorts keep ordinary coverage', () => {
    expect(shortsParts('white tank top, denim shorts')).toEqual({ fit: '', negative: '' });
    expect(shortsParts('black bike shorts')).toEqual({ fit: '', negative: '' });
    expect(shortsParts('white tee, blue jeans')).toEqual({ fit: '', negative: '' });
  });
  it('short and tiny shorts keep a short inseam (E3 came out as bike shorts)', () => {
    expect(shortsParts(OUTFITS.E3)).toEqual({ fit: TINY_SHORTS_FIT, negative: SHORT_SHORTS_NEGATIVE });
    expect(shortsParts(OUTFITS.E1)).toEqual({ fit: TINY_SHORTS_FIT, negative: SHORT_SHORTS_NEGATIVE });
    expect(shortsParts('grey running shorts')).toEqual({ fit: '', negative: SHORT_SHORTS_NEGATIVE });
  });
  it('explicitly cheeky shorts get the cheeky cut (E2, E4 covered both cheeks)', () => {
    for (const o of [OUTFITS.E2, OUTFITS.E4, 'black booty shorts', 'denim shorts showing the lower buttocks']) {
      expect(shortsParts(o)).toEqual({ fit: CHEEKY_FIT, negative: `${SHORT_SHORTS_NEGATIVE}, ${CHEEKY_NEGATIVE}` });
    }
  });
  it('the cut goes right after the outfit, and only with the fix; her figure wording is untouched', () => {
    const f = bench(OUTFITS.E4, { pose: 'standing, seen from behind, looking back over shoulder' });
    const on = build(f, ['shorts']);
    const off = build(f);
    expect(on.positive.indexOf(CHEEKY_FIT)).toBeGreaterThan(on.positive.indexOf('booty shorts'));
    expect(off.positive).not.toContain(CHEEKY_FIT);
    expect(on.positive).toContain('(large round natural breasts:1.2), slim toned waist with defined abs, curvy hips');
  });
});

describe('tankfit: an ordinary tank top stays full-length', () => {
  it('with the fix: "long tank top" after the outfit and knots in the negative; without it, the live negative-only rule', () => {
    const on = build(bench(OUTFITS.B1), ['tankfit']);
    expect(on.positive).toContain(TANK_FIT);
    expect(on.negative).toContain(KNOT_NEGATIVE);
    expect(on.negative).toContain(COVER_STOMACH_NEGATIVE);
    const off = build(bench(OUTFITS.B1));
    expect(off.positive).not.toContain(TANK_FIT);
    expect(off.negative).not.toContain(KNOT_NEGATIVE);
    expect(off.negative).toContain(COVER_STOMACH_NEGATIVE);
  });
  it('a requested crop or underboob tank is left alone', () => {
    expect(build(bench(OUTFITS.C2), ['tankfit']).positive).not.toContain(TANK_FIT);
    expect(build(bench('white cropped tank top, denim shorts'), ['tankfit']).negative).not.toContain(COVER_STOMACH_NEGATIVE);
  });
});

describe('underboobtank: the underboob pack on an underboob tank top', () => {
  it('is blocked today, allowed with the fix, and never when the tank top is a separate garment', () => {
    expect(packFitsOutfit('underboob_shirt', OUTFITS.C2)).toBe(false);
    expect(packFitsOutfit('underboob_shirt', OUTFITS.C2, { underboobTank: true })).toBe(true);
    expect(packFitsOutfit('underboob_shirt', 'white underboob tee, grey tank top', { underboobTank: true })).toBe(false);
    expect(packsForDescription({ outfit: OUTFITS.C2 }, 'adult', { underboobTank: true })).toEqual({ underboob_shirt: 0.6 });
    expect(packsForDescription({ outfit: OUTFITS.C2 }, 'adult')).toEqual({});
    expect(UNDERBOOB_TANK_RE.test(OUTFITS.C2)).toBe(true);
  });
  it('a plain tank top still keeps its full-length rule', () => {
    expect(build(bench(OUTFITS.B1)).negative).toContain(COVER_STOMACH_NEGATIVE);
  });
});

describe('AI check rules', () => {
  it('coverage is always checked for a clothed request; cheeky cut and framing only with checkrules', () => {
    expect(checkRules(bench(OUTFITS.D3), [])).toEqual([COVERAGE_RULE]);
    expect(checkRules(bench(OUTFITS.E4), ['checkrules'])).toEqual([COVERAGE_RULE, CHEEKY_RULE, KNEE_FRAMING_RULE]);
    expect(checkRules(bench(OUTFITS.E3, { framing: 'full body, head to toe' }), ['checkrules'])).toEqual([COVERAGE_RULE, FULL_BODY_FRAMING_RULE]);
    expect(checkRules(bench('completely nude', { framing: '' }), ['checkrules'])).toEqual([]);
  });
  it('rules go after the request; none = the message as before', () => {
    expect(checkUser('Sienna in a bikini')).toBe('Request:\nSienna in a bikini\n\nGrade this photo against every requirement of the request.');
    expect(checkUser('x', [CHEEKY_RULE])).toContain(`Also apply these rules for this request:\n- ${CHEEKY_RULE}`);
  });
});

describe('rear standing skeletons', () => {
  it('are test-only, portrait, and drawn head to knees (no ankles)', () => {
    for (const id of ['standing_rear_knee_up', 'standing_rear_knee_up_away']) {
      const p = POSE_PRESETS.find((x) => x.id === id);
      expect(p).toMatchObject({ width: 832, height: 1216, testOnly: true });
    }
  });
});
