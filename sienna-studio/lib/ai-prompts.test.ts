import { describe, expect, it } from 'vitest';
import { aiCost, cleanRead, NUDE_RE, readerSystem, type ReadResult } from './ai-prompts';
import { offeredGuides, posePreset, presetFitsCamera } from './pose-presets';
import { exposureWarning, failed, pickAttempt, type ExposureAttempt } from './exposure';

const base: ReadResult = {
  outfit: 'pink string bikini', pose: '', bodyPresentation: '', expression: '', setting: '', lighting: '', camera: '', framing: '',
  realism: '', extra: '', avoid: '', posePreset: '', packs: [], understood: '', hard: [],
};

describe('AI reader guard rails', () => {
  it('never sends nudity to the AI', () => {
    for (const t of ['completely nude on her bed', 'topless at the beach', 'wearing nothing at all']) expect(NUDE_RE.test(t)).toBe(true);
    for (const t of ['tiny string bikini with thong bottoms', 'white lace bra', 'gray pajama shorts']) expect(NUDE_RE.test(t)).toBe(false);
  });
  it('keeps only known packs (max two) and pose presets', () => {
    const r = cleanRead({ ...base, packs: ['string_swimsuit', 'made_up', 'natural_skin', 'monokini', 'string_swimsuit'], posePreset: 'cartwheel' }, ['string_swimsuit', 'natural_skin', 'monokini']);
    expect(r.packs).toEqual(['string_swimsuit', 'natural_skin']);
    expect(r.posePreset).toBe('');
    expect(cleanRead({ ...base, posePreset: 'lying_on_back' }, []).posePreset).toBe('lying_on_back');
  });
  it('offers adult packs only when adult mode is allowed, and never the nude or anatomy packs', () => {
    expect(readerSystem(false)).not.toContain('string_swimsuit');
    expect(readerSystem(true)).toContain('string_swimsuit');
    expect(readerSystem(true)).not.toMatch(/realistic_nudes|real_innie/);
  });
  it('prices calls (Opus 5.5: $4 / $20 per million)', () => {
    expect(aiCost('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
    expect(aiCost('claude-opus-5-5', { input_tokens: 0, output_tokens: 100_000 })).toBeCloseTo(2);
  });
});

describe('AI check in the photo checks', () => {
  const a = (o: Partial<ExposureAttempt>): ExposureAttempt => ({ seed: 1, exposed: false, score: 0, images: [], faceOk: true, identity: 'verified', similarity: 0.8, ...o });
  it('a miss is redone; no verdict is not a miss', () => {
    expect(failed(a({ aiOk: false }))).toBe(true);
    expect(failed(a({}))).toBe(false);
  });
  it('keeps the photo the checker liked when all were redone', () => {
    const miss = a({ seed: 1, aiOk: false, aiScore: 3, aiIssues: ['anatomy: merged fingers'] });
    const better = a({ seed: 2, aiOk: false, aiScore: 6, aiIssues: ['outfit: top is gray, not red'] });
    expect(pickAttempt([miss, better]).seed).toBe(2);
    const w = exposureWarning([miss, better], better)!;
    expect(w).toContain("didn't match your description");
    expect(w).toContain('Still not right in the kept photo: outfit: top is gray, not red');
  });
  it('the face still outranks the AI score', () => {
    const wrongFace = a({ seed: 1, faceOk: false, identity: 'mismatch', aiOk: true, aiScore: 9 });
    const offDesc = a({ seed: 2, aiOk: false, aiScore: 4 });
    expect(pickAttempt([wrongFace, offDesc]).seed).toBe(2);
  });
});

import { buildCorrection } from './corrections';
import { nextRetry, RETRY_BUDGET } from './exposure';

describe('retry budget (first live AI test: face redos used every try)', () => {
  const a = (o: Partial<ExposureAttempt>): ExposureAttempt => ({ seed: 1, exposed: false, score: 0, images: [], faceOk: true, ...o });
  it('face misses get at most two redos, then a correction can still happen', () => {
    const seq = [a({ faceOk: false, redoneFor: 'face' }), a({ faceOk: false, redoneFor: 'face' }), a({ faceOk: false })];
    expect(nextRetry(seq, 5)).toBeNull();
    const seq2 = [a({ faceOk: false, redoneFor: 'face' }), a({ faceOk: false, redoneFor: 'face' }), a({ aiOk: false })];
    expect(nextRetry(seq2, 5)).toBe('correction');
  });
  it('corrections get at most two redos; an exposed photo is always redone while attempts remain', () => {
    expect(RETRY_BUDGET).toEqual({ face: 2, correction: 2 });
    const seq = [a({ aiOk: false, redoneFor: 'correction' }), a({ aiOk: false, redoneFor: 'correction' }), a({ aiOk: false })];
    expect(nextRetry(seq, 5)).toBeNull();
    expect(nextRetry([a({}), a({ exposed: true })], 5)).toBe('safety');
    expect(nextRetry([a({}), a({}), a({}), a({}), a({ exposed: true })], 5)).toBeNull();
  });
  it('a photo the AI could not judge is not redone and is not a pass', () => {
    const unj = a({ aiStatus: 'unavailable', aiReason: 'the AI declined to assess it' });
    expect(nextRetry([unj], 5)).toBeNull();
    expect(exposureWarning([unj], unj)).toContain('Not checked against your description: the AI declined to assess it');
  });
  it('keeps the best photo, not the last', () => {
    const good = a({ seed: 1, aiOk: false, aiScore: 7, identity: 'verified', similarity: 0.8 });
    const worse = a({ seed: 2, aiOk: false, aiScore: 3, identity: 'likely', similarity: 0.71 });
    expect(pickAttempt([good, worse]).seed).toBe(1);
  });
});

describe('targeted corrections', () => {
  const prompts = { positive: 'standing in her kitchen, white crop top', negative: 'blurry' };
  it('turns the checker feedback into weighted fixes and negatives, keeping the original prompt', () => {
    const c = buildCorrection(
      [
        { aspect: 'outfit', problem: 'lace shorts became denim', major: true, emphasize: 'white lace shorts', avoid: 'denim shorts' },
        { aspect: 'scene', problem: 'pool a bit small', major: false, emphasize: 'big pool', avoid: '' },
      ],
      prompts,
    );
    expect(c.positive).toBe('(white lace shorts:1.25)');
    expect(c.negative).toBe('denim shorts');
    expect(c.newSeed).toBe(false); // outfit fix: keep the composition that was fine
    expect(c.summary).toEqual(['outfit: white lace shorts (not denim shorts)']);
  });
  it('a pose or anatomy problem needs a new composition and the anatomy negatives', () => {
    const c = buildCorrection(
      [
        { aspect: 'pose', problem: 'one hand on the mug', major: true, emphasize: 'both hands holding the white mug', avoid: 'one hand on the bed' },
        { aspect: 'anatomy', problem: 'extra finger', major: true, emphasize: 'hands with five fingers', avoid: 'extra fingers' },
      ],
      prompts,
    );
    expect(c.newSeed).toBe(true);
    expect(c.positive).toContain('(both hands holding the white mug:1.25)');
    expect(c.negative).toContain('fused fingers');
  });
});

import { pickFixes } from './corrections';
import { CAMERA_ANGLE_RE } from './pose-presets';

describe('live controlled test fixes (21 Oct)', () => {
  const i = (aspect: string, emphasize: string, major = true) => ({ aspect, problem: aspect, major, emphasize, avoid: '' });
  it('fixes don\'t pile up: latest first, earlier ones only for other aspects, at most 3', () => {
    const earlier = [[i('outfit', 'black bike shorts'), i('camera', 'low angle looking up')]];
    const latest = [i('camera', 'low camera angle near the floor'), i('pose', 'left hand holding the glass')];
    expect(pickFixes(latest, earlier).map((x) => x.emphasize)).toEqual(['low camera angle near the floor', 'left hand holding the glass', 'black bike shorts']);
    expect(pickFixes([i('a', '1'), i('b', '2'), i('c', '3'), i('d', '4')], []).length).toBe(3);
  });
  it('a camera angle keeps the pose presets away', () => {
    expect(CAMERA_ANGLE_RE.test('taken from a low angle, looking up at her, full body')).toBe(true);
    expect(CAMERA_ANGLE_RE.test('casual iPhone photo taken by a friend')).toBe(false);
  });
});

describe('broken anatomy loses a tie', () => {
  it('two photos with the same AI score: the one with a third hand is not kept', () => {
    const base = { exposed: false, score: 0, images: [], faceOk: true, identity: 'verified' as const, aiOk: false, aiScore: 3 };
    const thirdHand = { ...base, seed: 1, similarity: 0.78, aiFixes: [{ aspect: 'anatomy', problem: 'third hand', major: true, emphasize: '', avoid: '' }] };
    const wrongShirt = { ...base, seed: 2, similarity: 0.74, aiFixes: [{ aspect: 'outfit', problem: 'tee not shirt', major: true, emphasize: '', avoid: '' }] };
    expect(pickAttempt([thirdHand, wrongShirt]).seed).toBe(2);
  });
});

describe('anatomy is a critical failure', () => {
  const base = { exposed: false, score: 0, images: [], faceOk: true, aiOk: false };
  const anatomy = [{ aspect: 'anatomy', problem: 'extra arm', major: true, emphasize: 'two arms', avoid: 'extra arm' }];
  it('a better face and score never outweigh an extra arm', () => {
    const extraArm = { ...base, seed: 1, identity: 'verified' as const, similarity: 0.82, aiScore: 8, aiIssues: ['anatomy: extra arm'], aiFixes: anatomy };
    const wrongPose = { ...base, seed: 2, identity: 'likely' as const, similarity: 0.71, aiScore: 4, aiIssues: ['pose: standing, not sitting'], aiFixes: [{ ...anatomy[0], aspect: 'pose' }] };
    expect(pickAttempt([extraArm, wrongPose]).seed).toBe(2);
  });
  it('says so when every photo had a problem, anatomy first', () => {
    const one = { ...base, seed: 1, identity: 'verified' as const, similarity: 0.8, aiStatus: 'fail' as const, aiIssues: ['pose: standing', 'anatomy: extra arm'], aiFixes: anatomy };
    const two = { ...one, seed: 2 };
    const w = exposureWarning([one, two], two)!;
    expect(w).toContain('None of the 2 photos fully matched');
    expect(w).toContain('anatomy error');
    expect(w.indexOf('anatomy: extra arm')).toBeLessThan(w.indexOf('pose: standing'));
  });
});

describe('pose guides', () => {
  it('are offered to the reader only when on', () => {
    expect(readerSystem(false)).not.toContain('sitting_edge_hands_chest');
    expect(readerSystem(false, offeredGuides(true))).toContain('sitting_edge_hands_chest');
    expect(cleanRead({ ...base, posePreset: 'standing_low_angle' }, []).posePreset).toBe('');
    expect(cleanRead({ ...base, posePreset: 'standing_low_angle' }, [], offeredGuides(true)).posePreset).toBe('standing_low_angle');
    expect(offeredGuides(false)).toEqual([]);
    // an experimental guide is not offered when only the everyday ones are
    expect(cleanRead({ ...base, posePreset: 'leaning_counter_foot_up' }, [], ['standing_low_angle']).posePreset).toBe('');
  });
  it('the low-angle skeleton only with a low angle; eye-level ones never with a camera angle', () => {
    const low = posePreset('standing_low_angle')!;
    const edge = posePreset('sitting_edge_hands_chest')!;
    expect(presetFitsCamera(low, 'photo taken from a low angle, looking up at her')).toBe(true);
    expect(presetFitsCamera(low, 'casual phone photo')).toBe(false);
    expect(presetFitsCamera(edge, 'casual phone photo')).toBe(true);
    expect(presetFitsCamera(edge, 'shot from above')).toBe(false);
  });
});
