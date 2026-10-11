import { describe, expect, it } from 'vitest';
import { exposureNode, softenPacks, exposureWarning, outfitHasTop, parseExposure, pickAttempt, reseed } from './exposure';
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
    expect(exposureWarning([a, c], c)).toContain('1 photo showed a nipple and was redone');
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
