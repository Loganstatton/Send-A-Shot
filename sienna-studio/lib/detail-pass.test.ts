import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { addDetailPass, bareBelow, DETAIL_NODES, DETAIL_REAR_WORDS, DETAIL_WORDS, detailFile, detailPassFromEnv, parseDetailPass } from './comfy/detail-pass';
import type { ComfyGraph } from './types';

const prod = (): ComfyGraph => JSON.parse(readFileSync(new URL('../workflows/examples/sienna-sdxl-production.json', import.meta.url), 'utf8'));
const opts = { style: 'peach' as const, rear: false, baseLoraId: '2', faceRefineId: '51' };

describe('close-up detail pass', () => {
  it('cuts a close-up of the final image, redraws it with the detail LoRA and pastes it back before saving', () => {
    const g = addDetailPass(prod(), opts)!;
    const n = DETAIL_NODES;
    expect(g['42'].inputs.images).toEqual([n.paste, 0]);
    expect(g[n.region].inputs).toMatchObject({ image: ['51', 0], threshold: 0.3, size: 1024 });
    expect(g[n.encode].inputs.pixels).toEqual([n.region, 0]);
    expect(g[n.noiseMask].inputs).toEqual({ samples: [n.encode, 0], mask: [n.region, 1] });
    expect(g[n.sampler].inputs).toMatchObject({ model: [n.lora, 0], latent_image: [n.noiseMask, 0], denoise: 0.5 });
    expect(g[n.paste].inputs).toEqual({ original: ['51', 0], redrawn: [n.decode, 0], info: [n.region, 2] });
    expect(g[n.lora].inputs).toMatchObject({ model: ['2', 0], clip: ['2', 1], lora_name: 'pack_99174_front.safetensors', strength_model: 0.7 });
    expect(g[n.positive].inputs.text).toBe(DETAIL_WORDS);
    expect(g[n.negative].inputs.text).toContain(prod()['4'].inputs.text);
    // the main photo, face pass and her LoRA are untouched
    const before = prod();
    for (const id of ['3', '40', '51', '2']) expect(g[id]).toEqual(before[id]);
  });
  it('rear view: the rear version of Peach and rear wording; other styles use one file and their own settings', () => {
    const g = addDetailPass(prod(), { ...opts, rear: true })!;
    expect(g[DETAIL_NODES.lora].inputs.lora_name).toBe('pack_99174.safetensors');
    expect(String(g[DETAIL_NODES.positive].inputs.text).startsWith(DETAIL_REAR_WORDS)).toBe(true);
    expect(detailFile('lotte', true)).toBe('pack_89005.safetensors');
    const b = addDetailPass(prod(), { ...opts, style: 'butterfly', denoise: 0.4, strength: 0.6 })!;
    expect(b[DETAIL_NODES.positive].inputs.text).toContain('butterfly pussy');
    expect(b[DETAIL_NODES.sampler].inputs.denoise).toBe(0.4);
    expect(b[DETAIL_NODES.lora].inputs.strength_model).toBe(0.6);
  });
  it('nothing to hook into: no pass', () => {
    expect(addDetailPass(prod(), { ...opts, faceRefineId: 'nope' })).toBeNull();
    const g = prod();
    delete g['42'];
    expect(addDetailPass(g, opts)).toBeNull();
  });
  it('SIENNA_DETAIL picks a style; anything else is off', () => {
    expect(detailPassFromEnv('peach')).toEqual({ style: 'peach' });
    expect(detailPassFromEnv(undefined)).toBeUndefined();
    expect(detailPassFromEnv('on')).toBeUndefined();
  });
  it('only when nothing covers her below the waist', () => {
    expect(bareBelow('completely nude', true)).toBe(true);
    expect(bareBelow('white crop top, bottomless', false)).toBe(true);
    expect(bareBelow('oversized shirt, no panties', false)).toBe(true);
    expect(bareBelow('nude thong', false)).toBe(false);
    expect(bareBelow('bottomless, black thong', false)).toBe(false);
    expect(bareBelow('no panties under a short skirt', false)).toBe(false);
    expect(bareBelow('tiny black thong, topless', false)).toBe(false);
    expect(bareBelow('', false)).toBe(false);
  });
  it('reads the paste report', () => {
    expect(parseDetailPass({ [DETAIL_NODES.paste]: ['{"pasted":true,"side":195,"score":0.566,"color_shift":[1,0,-1],"mean_change":0.4}'] })).toEqual({ pasted: true, score: 0.566, side: 195 });
    expect(parseDetailPass({ [DETAIL_NODES.paste]: ['{"skipped":"no exposed genital area found"}'] })).toEqual({ skipped: 'no exposed genital area found' });
    expect(parseDetailPass({})).toBeUndefined();
  });
});
