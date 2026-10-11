import { describe, expect, it } from 'vitest';
import { addCoverage, exposureNode, failed, softenPacks, exposureWarning, outfitHasTop, parseExposure, pickAttempt, reseed } from './exposure';
import type { ComfyGraph } from './types';

const graph: ComfyGraph = {
  '40': { class_type: 'KSampler', inputs: { seed: 7, steps: 30 } },
  '51': { class_type: 'FaceDetailer', inputs: { seed: 7, image: ['41', 0] } },
  '60': { class_type: 'Other', inputs: { seed: 99 } },
  '42': { class_type: 'SaveImage', inputs: { images: ['51', 0], filename_prefix: 'sienna' } },
};

describe('exposure guard helpers', () => {
  it('knows when the outfit has a top', () => {
    expect(outfitHasTop('black plunging monokini')).toBe(true);
    expect(outfitHasTop('black monokini swimsuit')).toBe(true);
    expect(outfitHasTop('white underboob shirt, denim shorts')).toBe(true);
    expect(outfitHasTop('topless, denim shorts')).toBe(false);
    expect(outfitHasTop('denim shorts')).toBe(false);
  });

  it('checks the image that goes into SaveImage', () => {
    expect(exposureNode(graph, '42')).toMatchObject({ class_type: 'SiennaExposureCheck', inputs: { images: ['51', 0] } });
    expect(exposureNode(graph, '40')).toBeNull();
  });

  it('parses the node report', () => {
    expect(parseExposure(['{"available":true,"exposed":true,"score":0.8}'])).toEqual({ available: true, exposed: true, score: 0.8, error: undefined });
    expect(parseExposure(['{"available":false,"error":"ModuleNotFoundError"}'])?.available).toBe(false);
    expect(parseExposure(undefined)).toBeNull();
    expect(parseExposure(['not json'])).toBeNull();
  });

  it('reseeds only the inputs that held the old seed', () => {
    const g = reseed(graph, 7, 123);
    expect(g['40'].inputs.seed).toBe(123);
    expect(g['51'].inputs.seed).toBe(123);
    expect(g['60'].inputs.seed).toBe(99);
    expect(graph['40'].inputs.seed).toBe(7); // original untouched
  });

  it('keeps the first covered photo, else the least exposed', () => {
    const a = { seed: 1, exposed: true, score: 0.85, images: ['a'] };
    const b = { seed: 2, exposed: true, score: 0.63, images: ['b'] };
    const c = { seed: 3, exposed: false, score: 0, images: ['c'] };
    expect(pickAttempt([a, c]).seed).toBe(3);
    expect(pickAttempt([a, b]).seed).toBe(2);
    expect(exposureWarning([a, c], c)).toContain('redid 1 photo (1 showed a nipple)');
    expect(exposureWarning([a, b], b)).toContain('all 2 attempts');
    expect(exposureWarning([c], c)).toBeNull();
  });
});

describe('softenPacks', () => {
  it('turns style packs down a notch and leaves Sienna alone', () => {
    const g: ComfyGraph = {
      '2': { class_type: 'LoraLoader', inputs: { lora_name: 'sienna_v2.safetensors', strength_model: 1, strength_clip: 1 } },
      p1: { class_type: 'LoraLoader', inputs: { lora_name: 'pack_385723.safetensors', strength_model: 0.3, strength_clip: 0.3 }, _meta: { title: 'Style pack: Monokini' } },
    };
    const s = softenPacks(g);
    expect(s['2'].inputs.strength_model).toBe(1);
    expect(s.p1.inputs.strength_model).toBe(0.24);
    expect(softenPacks(s).p1.inputs.strength_clip).toBe(0.19);
  });
});

describe('addCoverage', () => {
  it('adds the coverage wording to the prompt nodes once', () => {
    const g: ComfyGraph = {
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'monokini, sienna_v1 woman' } },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: 'lowres' } },
    };
    const prompts = { positive: 'monokini, sienna_v1 woman', negative: 'lowres' };
    const c = addCoverage(g, prompts, { positive: '(wide straps:1.4)', negative: 'nipples' });
    expect(c.graph['3'].inputs.text).toBe('(wide straps:1.4), monokini, sienna_v1 woman');
    expect(c.graph['4'].inputs.text).toBe('lowres, nipples');
    const again = addCoverage(c.graph, { positive: c.positive, negative: c.negative }, { positive: '(wide straps:1.4)', negative: 'nipples' });
    expect(again.graph['3'].inputs.text).toBe(c.positive);
    expect(addCoverage(g, prompts, { positive: '', negative: '' }).graph).toEqual(g);
  });
});

describe('framing in the photo checks', () => {
  it('redoes a full-body shot that came out close, and keeps the right framing over a slightly closer face', () => {
    const close = { seed: 1, exposed: false, score: 0, similarity: 0.84, faceOk: true, framingOk: false, images: ['a'] };
    const right = { seed: 2, exposed: false, score: 0, similarity: 0.78, faceOk: true, framingOk: true, images: ['b'] };
    expect(failed(close)).toBe(true);
    expect(pickAttempt([close, right]).seed).toBe(2);
    expect(pickAttempt([right, close]).seed).toBe(2);
    expect(exposureWarning([close, right], right)).toContain('1 came out closer than full body');
  });
});

describe('framingOk', () => {
  it('only judges full-body requests', async () => {
    const { framingOk } = await import('./identity');
    expect(framingOk(true, 150, 1216)).toBe(false);
    expect(framingOk(true, 100, 1216)).toBe(true);
    expect(framingOk(false, 400, 1216)).toBe(true);
    expect(framingOk(true, null, 1216)).toBe(true);
  });
});

describe('pose-aware face check in the retry loop', () => {
  const att = (seed: number, identity: 'verified' | 'mismatch' | 'inconclusive', similarity: number) => ({
    seed, exposed: false, score: 0, similarity, identity,
    ...(identity === 'verified' ? { faceOk: true } : identity === 'mismatch' ? { faceOk: false } : { identityReason: 'her face is turned away' }),
    images: [],
  });

  it('an inconclusive face is not redone, and is never reported as a match', () => {
    const a = att(1, 'inconclusive', 0.62);
    expect(failed(a)).toBe(false);
    expect(pickAttempt([a]).seed).toBe(1);
    const note = exposureWarning([a], a)!;
    expect(note).toContain('Face check inconclusive: her face is turned away (similarity 0.62)');
    expect(note).toContain('not confirmed as Sienna');
  });

  it('a mismatch is still redone, and a verified face beats an unjudged one when picking', () => {
    const miss = att(1, 'mismatch', 0.41);
    const unsure = att(2, 'inconclusive', 0.7);
    const sure = att(3, 'verified', 0.76);
    expect(failed(miss)).toBe(true);
    const miss2 = att(4, 'mismatch', 0.45);
    expect(pickAttempt([sure, unsure, miss, miss2]).seed).toBe(3);
    expect(pickAttempt([unsure, miss, miss2]).seed).toBe(2);
    expect(exposureWarning([miss, unsure], unsure)).toMatch(/redid 1 photo \(1 didn't look enough like Sienna\); kept seed 2\. Face check inconclusive/);
  });

  it('a verified first photo needs no note', () => {
    const ok = att(1, 'verified', 0.85);
    expect(exposureWarning([ok], ok)).toBeNull();
  });
});
