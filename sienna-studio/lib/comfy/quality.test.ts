import { describe, expect, it } from 'vitest';
import prev from './__fixtures__/sienna-sdxl-production.prev.json';
import { validateBindings } from './adapter';
import { builtinWorkflows } from './builtin-workflows';
import { filterBindings, MODULE_KEYS, pruneModule } from './modules';
import { applyQualityOptions, posePadding } from './quality';
import type { ComfyGraph } from '../types';

const w = builtinWorkflows().find((x) => x.id === 'sienna-sdxl-production')!;
const apply = (o: Parameters<typeof applyQualityOptions>[2]) => applyQualityOptions(w.graph, w.bindings, o);

describe('applyQualityOptions', () => {
  it('everything off reproduces the previous production graph exactly', () => {
    expect(apply({})).toEqual(prev as ComfyGraph);
  });

  it('pose fit pad: the detector reads the padded photo', () => {
    const g = apply({ posePad: { left: 0, right: 0, top: 96, bottom: 104 } });
    expect(g['23'].inputs.image).toEqual(['24', 0]);
    expect(g['24'].inputs).toMatchObject({ image: ['20', 0], top: 96, bottom: 104, left: 0, right: 0, feathering: 0 });
  });

  it('pose retarget: the ControlNet reads the retargeted skeleton, built from DWPose keypoints', () => {
    const g = apply({ poseRetarget: 1 });
    expect(g['22'].inputs.image).toEqual(['25', 0]);
    expect(g['25'].inputs.pose_keypoint).toEqual(['23', 1]);
  });

  it('refinement: final decode reads the refined latent; the refiner reads the first pass', () => {
    const g = apply({ hires: true });
    expect(g['41'].inputs.samples).toEqual(['85', 0]);
    expect(g['80'].inputs.samples).toEqual(['40', 0]);
    expect(g['85'].inputs.latent_image).toEqual(['82', 0]);
    expect(g['51'].inputs.image).toEqual(['41', 0]); // face refinement still runs on the final image
  });

  it('garment mode: the clothing adapter reads the uploaded crop; in-graph isolation is removed', () => {
    const g = apply({ garmentImage: true });
    expect(g['69'].inputs.image).toEqual(['60', 0]);
    for (const id of ['61', '62', '63', '64', '65', '66', '67', '68']) expect(g[id]).toBeUndefined();
    expect(g['50']).toBeDefined(); // the face refiner's own detector is untouched
  });

  it('with everything on, every optional module can still be removed cleanly', () => {
    let g = apply({ posePad: { left: 8, right: 8, top: 0, bottom: 0 }, poseRetarget: 1, hires: true, garmentImage: true });
    let b = filterBindings(g, w.bindings);
    for (const k of MODULE_KEYS) ({ graph: g, bindings: b } = pruneModule(g, b, k));
    expect(validateBindings(g, b)).toEqual([]);
    expect(g['85'].inputs.model).toEqual(['83', 0]); // refiner keeps its own-strength LoRA
    expect(g['85'].inputs.positive).toEqual(['3', 0]);
    expect(g['40'].inputs.model).toEqual(['2', 0]);
    for (const id of ['20', '21', '22', '23', '24', '25', '60', '69', '72', '84']) expect(g[id]).toBeUndefined();
  });
});

describe('posePadding', () => {
  it('pads a taller photo left/right to the output aspect', () => {
    // 942×1669 photo (0.564) into 832×1216 (0.684)
    const p = posePadding(942, 1669, 832, 1216)!;
    expect(p.top).toBe(0);
    expect(p.left % 8).toBe(0);
    expect(Math.abs((942 + p.left + p.right) / 1669 - 832 / 1216)).toBeLessThan(0.01);
  });
  it('pads a wider photo top/bottom', () => {
    const p = posePadding(1600, 900, 832, 1216)!;
    expect(p.left).toBe(0);
    expect(Math.abs(1600 / (900 + p.top + p.bottom) - 832 / 1216)).toBeLessThan(0.01);
  });
  it('no padding when shapes already match or size unknown', () => {
    expect(posePadding(832, 1216, 832, 1216)).toBeNull();
    expect(posePadding(undefined, 1000, 832, 1216)).toBeNull();
  });
});
