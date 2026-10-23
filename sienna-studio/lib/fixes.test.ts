import { describe, expect, it } from 'vitest';
import {
  ATHLETIC_SHORTS_FIT,
  buildPrompt,
  CHEEKY_FIT,
  CHEEKY_NEGATIVE,
  COVER_STOMACH_NEGATIVE,
  LOGO_NEGATIVE,
  outfitHasBottom,
  SHORT_SHORTS_NEGATIVE,
  shortsParts,
  TINY_SHORTS_FIT,
} from './prompt';
import { DEFAULT_CHARACTER, EMPTY_FIELDS } from './defaults';
import { FIXES, fixesFromEnv, type Fix } from './fixes';
import { framingLevels, kneeUpRequest, withoutThighUp } from './framing';
import { KNEE_EDGE, kneeFramingOk, type BodyFrame } from './body-frame';
import { checkRules, checkUser, CHEEKY_RULE, COVERAGE_RULE, FULL_BODY_FRAMING_RULE, KNEE_FRAMING_RULE } from './ai-prompts';
import { packFitsOutfit, packsForDescription, REAR_UNSAFE_PACKS, resolvePackConflicts, withoutRearUnsafePacks } from './style-packs';
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
const build = (f: PromptFields, fixes: Fix[] = [], mode: 'sfw' | 'adult' = 'sfw') =>
  buildPrompt({ fields: f, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: mode, coverStomach: ['tank', 'buttonup'], fixes });

describe('fix switches', () => {
  it('SIENNA_FIXES: a comma list of known fixes, true = all; removed fixes are ignored', () => {
    expect(FIXES).toEqual(['rearguide', 'kneeguide', 'shorts', 'cheeky', 'checkrules']);
    expect(fixesFromEnv(undefined)).toEqual([]);
    expect(fixesFromEnv('shorts, kneeguide,colour,tankfit,bogus')).toEqual(['shorts', 'kneeguide']);
    expect(fixesFromEnv('true')).toEqual([...FIXES]);
  });
  it('with no fixes on, every benchmark prompt is exactly what production sends today', () => {
    for (const outfit of Object.values(OUTFITS)) {
      const f = bench(outfit);
      const prod = buildPrompt({ fields: f, character: DEFAULT_CHARACTER, siennaLock: true, contentMode: 'sfw', coverStomach: ['tank', 'buttonup'] });
      expect(build(f)).toEqual(prod);
      expect(prod.positive).toContain('three-quarter shot');
      expect(prod.positive).not.toContain(CHEEKY_FIT);
    }
  });
});

describe('pack stacking (live since 23 Oct)', () => {
  it('the micro pack never stacks on the string swimsuit pack, however the packs were chosen', () => {
    expect(resolvePackConflicts({ micro_bikini: 0.85, string_swimsuit: 0.7 })).toEqual({ packs: { string_swimsuit: 0.7 }, dropped: ['micro_bikini'] });
    expect(resolvePackConflicts({ micro_bikini: 0.85, natural_skin: 0.3 })).toEqual({ packs: { micro_bikini: 0.85, natural_skin: 0.3 }, dropped: [] });
    expect(resolvePackConflicts({ french_lace: 0.6, lace_bodysuit: 0.6 }).packs).toEqual({ lace_bodysuit: 0.6 });
  });
  it('a micro string bikini gets the string swimsuit pack alone, at its tiny-string strength', () => {
    expect(packsForDescription({ outfit: OUTFITS.D3 }, 'adult')).toEqual({ string_swimsuit: 0.7 });
    expect(packsForDescription({ outfit: 'black micro bikini top, black micro bikini bottoms' }, 'sfw')).toEqual({ micro_bikini: 0.85 });
  });
  it('the underboob pack still never replaces a named tank top (on a tank it came out exposed 2 of 2)', () => {
    expect(packFitsOutfit('underboob_shirt', OUTFITS.C2)).toBe(false);
    expect(packsForDescription({ outfit: OUTFITS.C2 }, 'adult')).toEqual({});
  });
  it('the micro bikini pack stays off rear views (exposure below the bottoms 4 of 4 from behind, 23 Oct)', () => {
    expect(REAR_UNSAFE_PACKS).toEqual(['micro_bikini']);
    expect(withoutRearUnsafePacks({ micro_bikini: 0.85, natural_skin: 0.3 }, true)).toEqual({ packs: { natural_skin: 0.3 }, dropped: ['micro_bikini'] });
    expect(withoutRearUnsafePacks({ micro_bikini: 0.85 }, false)).toEqual({ packs: { micro_bikini: 0.85 }, dropped: [] });
    expect(withoutRearUnsafePacks({ string_swimsuit: 0.7 }, true)).toEqual({ packs: { string_swimsuit: 0.7 }, dropped: [] });
  });
  it('a plain tank top keeps its full-length rule', () => {
    expect(build(bench(OUTFITS.B1)).negative).toContain(COVER_STOMACH_NEGATIVE);
  });
});

describe('framing: head to knees', () => {
  it('is a knee-up request; with kneeguide "three-quarter shot" (a thigh crop) next to it is dropped', () => {
    expect(kneeUpRequest('head to knees, three-quarter shot')).toBe(true);
    expect(kneeUpRequest('full body, head to toe')).toBe(false);
    expect(framingLevels('head to knees')).toEqual(['knee-up']);
    expect(withoutThighUp('head to knees, three-quarter shot')).toBe('head to knees');
    const on = build(bench(OUTFITS.B1), ['kneeguide']);
    expect(on.positive).not.toContain('three-quarter shot');
    expect(on.positive).toContain('head to knees');
    expect(on.negative).toEqual(build(bench(OUTFITS.B1)).negative);
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

describe('shorts: ordinary, short, athletic and cheeky are different requests', () => {
  it('ordinary shorts keep ordinary coverage', () => {
    expect(shortsParts('white tank top, denim shorts')).toEqual({ fit: '', negative: '' });
    expect(shortsParts('black bike shorts')).toEqual({ fit: '', negative: '' });
    expect(shortsParts('white tee, blue jeans')).toEqual({ fit: '', negative: '' });
  });
  it('short shorts keep a short inseam; athletic ones keep the athletic cut and no logos', () => {
    expect(shortsParts(OUTFITS.E3)).toEqual({ fit: `${TINY_SHORTS_FIT}, ${ATHLETIC_SHORTS_FIT}`, negative: `${SHORT_SHORTS_NEGATIVE}, ${LOGO_NEGATIVE}` });
    expect(shortsParts(OUTFITS.E1)).toEqual({ fit: TINY_SHORTS_FIT, negative: SHORT_SHORTS_NEGATIVE });
    expect(shortsParts('grey running shorts')).toEqual({ fit: ATHLETIC_SHORTS_FIT, negative: `${SHORT_SHORTS_NEGATIVE}, ${LOGO_NEGATIVE}` });
  });
  it('explicitly cheeky shorts get the cheeky cut, described as the garment only — and never briefs', () => {
    for (const o of [OUTFITS.E2, OUTFITS.E4, 'black booty shorts', 'denim shorts showing the lower buttocks']) {
      expect(shortsParts(o)).toEqual({ fit: CHEEKY_FIT, negative: `${SHORT_SHORTS_NEGATIVE}, ${CHEEKY_NEGATIVE}` });
    }
    expect(CHEEKY_FIT).not.toMatch(/butt|buttock|hips?|thigh|curve|body/i);
    expect(CHEEKY_NEGATIVE).toMatch(/briefs, panties, bikini bottoms/);
  });
  it('the cheeky cut needs its own switch: the shorts fix alone leaves cheeky shorts to the request\'s words', () => {
    const f = bench(OUTFITS.E4, { pose: 'standing, seen from behind, looking back over shoulder' });
    expect(build(f, ['shorts'])).toEqual(build(f));
    expect(shortsParts(OUTFITS.E4, false)).toEqual({ fit: '', negative: '' });
    expect(build(bench(OUTFITS.E3), ['shorts']).positive).toContain(ATHLETIC_SHORTS_FIT);
  });
  it('the cut goes right after the outfit, only with the cheeky fix; her figure wording is untouched', () => {
    const f = bench(OUTFITS.E4, { pose: 'standing, seen from behind, looking back over shoulder' });
    const on = build(f, ['cheeky']);
    expect(on.positive.indexOf(CHEEKY_FIT)).toBeGreaterThan(on.positive.indexOf('booty shorts'));
    expect(build(f).positive).not.toContain(CHEEKY_FIT);
    expect(on.positive).toContain('(large round natural breasts:1.2), slim toned waist with defined abs, curvy hips');
  });
});

describe('AI check rules', () => {
  it('coverage is always checked for a clothed request; cheeky cut and framing only with checkrules', () => {
    expect(outfitHasBottom('completely nude')).toBe(false);
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

describe('head-to-knees skeletons', () => {
  it('are test-only and portrait; the rear ones run at full ControlNet strength', () => {
    const p = (id: string) => POSE_PRESETS.find((x) => x.id === id);
    expect(p('standing_rear_knee_up')).toMatchObject({ width: 832, height: 1216, testOnly: true, strength: 1 });
    expect(p('standing_rear_knee_up_away')).toMatchObject({ testOnly: true, strength: 1 });
    expect(p('standing_knee_up')).toMatchObject({ width: 832, height: 1216, testOnly: true, strength: 0.85 });
  });
});
