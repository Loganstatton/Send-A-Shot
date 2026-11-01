import { describe, expect, it } from 'vitest';
import sdxl from '../../workflows/examples/sienna-sdxl-production.json';
import type { ComfyGraph } from '../types';
import { addKeepScene, KEEP_SCENE_PREFIX as P, sceneSize } from './keep-scene';
import { garmentLines } from './keep-scene';

const graph = () => {
  const g = structuredClone(sdxl) as ComfyGraph;
  g['40'].inputs.latent_image = ['32', 0]; // img2img: the first pass starts from the encoded init image
  for (const id of ['80', '81', '82', '83', '84', '85']) delete g[id]; // the unused hi-res pass (applyQualityOptions drops it)
  return g;
};

describe('sceneSize', () => {
  it('keeps the photo’s shape near a megapixel', () => {
    const s = sceneSize(720, 1200);
    expect(s.width % 8).toBe(0);
    expect(s.height % 8).toBe(0);
    expect(Math.abs(s.width / s.height - 0.6)).toBeLessThan(0.01);
    expect(s.width * s.height).toBeGreaterThan(900_000);
  });
});

describe('addKeepScene', () => {
  it('redraws only the person (and overlays) and pastes the photo back around her', () => {
    const g = addKeepScene(graph(), { width: 776, uiMask: true })!;
    expect(g).not.toBeNull();
    expect(g['40'].inputs.latent_image).toEqual([`${P}noise`, 0]);
    expect(g['40'].inputs.denoise).toBe(1);
    expect(g[`${P}noise`].inputs.samples).toEqual(['32', 0]);
    expect(g[`${P}person`].inputs.image).toEqual(['31', 0]);
    expect(g[`${P}union`].inputs.source).toEqual([`${P}ui`, 0]);
    expect(g[`${P}paste`].inputs).toMatchObject({ destination: ['41', 0], source: ['31', 0], mask: [`${P}soft`, 0] });
    // what stays redrawn: the new person and the old one (and the overlays), never more than the redraw
    expect(g[`${P}new`].inputs.image).toEqual(['41', 0]);
    expect(g[`${P}within`].inputs).toMatchObject({ destination: [`${P}bothui`, 0], source: [`${P}union`, 0], operation: 'multiply' });
    expect(g[`${P}keep`].inputs.mask).toEqual([`${P}within`, 0]);
    // everything that read the decoded picture now reads the pasted one
    for (const [id, n] of Object.entries(g)) if (id !== `${P}paste` && id !== `${P}new`) for (const v of Object.values(n.inputs)) expect(v).not.toEqual(['41', 0]);
  });
  it('paints the overlays out instead of redrawing them when the node can', () => {
    const g = addKeepScene(graph(), { width: 776, uiMask: true, uiPaint: true })!;
    expect(g['32'].inputs.pixels).toEqual([`${P}ui`, 2]);
    expect(g[`${P}paste`].inputs.source).toEqual([`${P}ui`, 2]);
    expect(g[`${P}noise`].inputs.mask).toEqual([`${P}grow`, 0]);
    expect(g[`${P}union`]).toBeUndefined();
    expect(g[`${P}within`].inputs.destination).toEqual([`${P}both`, 0]);
    // a light second pass over the painted-out spots, and the rest of the graph reads its result
    expect(g[`${P}uiks`].inputs).toMatchObject({ denoise: 0.5, latent_image: [`${P}uinoise`, 0], positive: ['22', 0] });
    expect(g[`${P}uienc`].inputs.pixels).toEqual([`${P}paste`, 0]);
    for (const [id, n] of Object.entries(g)) if (!id.startsWith(P)) for (const v of Object.values(n.inputs)) expect(v).not.toEqual([`${P}paste`, 0]);
  });
  it('traces the garment’s outline with the union ControlNet when asked', () => {
    const g = addKeepScene(graph(), { width: 776, height: 1296, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors' } })!;
    expect(g['40'].inputs.positive).toEqual([`${P}cnapply`, 0]);
    expect(g['40'].inputs.negative).toEqual([`${P}cnapply`, 1]);
    expect(g[`${P}cnapply`].inputs.positive).toEqual(['22', 0]);
    expect(g[`${P}seg0`].inputs).toMatchObject({ text_input: 'bikini top', image: ['31', 0] });
    expect(g[`${P}lines`].inputs.mask).toEqual([`${P}gmask`, 0]);
    expect(g[`${P}cntype`].inputs.type).toBe('canny/lineart/anime_lineart/mlsd');
    expect(g[`${P}body`]).toBeUndefined();
  });
  it('adds her figure’s outline without the head when asked', () => {
    const g = addKeepScene(graph(), { width: 776, height: 1296, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors', body: true } })!;
    expect(g[`${P}body`].inputs).toMatchObject({ destination: [`${P}person`, 0], source: [`${P}face`, 0], operation: 'subtract' });
    expect(g[`${P}lines`].inputs.destination).toEqual([`${P}bodylines`, 0]);
    expect(g[`${P}cndapply`]).toBeUndefined();
  });
  it('adds her figure’s depth (no head) as a second guide when the server has a depth node', () => {
    const g = addKeepScene(graph(), { width: 776, height: 1296, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors', body: true, depth: 'DepthAnythingV2Preprocessor' } })!;
    expect(g[`${P}cndtype`].inputs.type).toBe('depth');
    expect(g[`${P}bodydepth`].inputs).toMatchObject({ source: [`${P}depth`, 0], mask: [`${P}body`, 0], resize_source: true });
    expect(g[`${P}cndapply`].inputs.positive).toEqual([`${P}cnapply`, 0]);
    expect(g['40'].inputs.positive).toEqual([`${P}cndapply`, 0]);
    expect(g['40'].inputs.negative).toEqual([`${P}cndapply`, 1]);
  });
  it('is skipped without an init image or with the hi-res pass', () => {
    expect(addKeepScene(structuredClone(sdxl) as ComfyGraph, { width: 776 })).toBeNull();
    const g = graph();
    g.x = { class_type: 'ImageScaleBy', inputs: {} };
    expect(addKeepScene(structuredClone(g), { width: 776 })).toBeNull();
    delete g.x;
    g['40'].inputs.latent_image = ['33', 0];
    expect(addKeepScene(g, { width: 776 })).toBeNull();
  });
});

describe('garmentLines', () => {
  it('defaults to the stronger outline and reads an override', () => {
    expect(garmentLines(undefined)).toEqual({ strength: 0.9, end: 0.65 });
    expect(garmentLines('0.75,0.65')).toEqual({ strength: 0.75, end: 0.65 });
    expect(garmentLines('junk')).toEqual({ strength: 0.9, end: 0.65 });
  });
});
