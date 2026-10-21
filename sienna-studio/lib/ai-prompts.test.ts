import { describe, expect, it } from 'vitest';
import { aiCost, cleanRead, NUDE_RE, readerSystem, type ReadResult } from './ai-prompts';
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
    expect(c.positive).toBe('(white lace shorts:1.3)');
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
    expect(c.positive).toContain('(both hands holding the white mug:1.3)');
    expect(c.negative).toContain('fused fingers');
  });
});
