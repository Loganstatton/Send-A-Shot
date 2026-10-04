import { describe, expect, it } from 'vitest';
import { applyBindings, validateBindings } from './adapter';
import { builtinWorkflows } from './builtin-workflows';
import { canPrune, garbageCollect, moduleNodeIds, MODULE_KEYS, pruneModule } from './modules';
import type { ComfyGraph, WorkflowTemplate } from '../types';

const wf = (id: string) => builtinWorkflows().find((w) => w.id === id)!;
const classes = (g: ComfyGraph) => Object.values(g).map((n) => n.class_type).sort();

function pruneAll(w: WorkflowTemplate) {
  let g = w.graph;
  let b = w.bindings;
  for (const k of MODULE_KEYS) ({ graph: g, bindings: b } = pruneModule(g, b, k));
  return { g, b };
}

describe('SDXL production: pruning all optional modules', () => {
  const { g, b } = pruneAll(wf('sienna-sdxl-production'));

  it('leaves exactly the plain txt2img + LoRA graph', () => {
    expect(classes(g)).toEqual(
      ['CLIPTextEncode', 'CLIPTextEncode', 'CheckpointLoaderSimple', 'EmptyLatentImage', 'KSampler', 'LoraLoader', 'SaveImage', 'VAEDecode'].sort(),
    );
  });

  it('rewires the sampler around IPAdapter, its loader, ControlNet and VAEEncode', () => {
    expect(g['40'].inputs.model).toEqual(['2', 0]); // straight from the Sienna LoRA
    expect(g['40'].inputs.positive).toEqual(['3', 0]);
    expect(g['40'].inputs.negative).toEqual(['4', 0]);
    expect(g['40'].inputs.latent_image).toEqual(['33', 0]); // empty latent instead of VAEEncode
  });

  it('keeps bindings consistent with the pruned graph', () => {
    expect(validateBindings(g, b)).toEqual([]);
    expect(b.face_reference_image).toBeUndefined();
    expect(b.width).toEqual([{ nodeId: '33', inputName: 'width' }]);
    expect(() => applyBindings(g, b, { seed: 1, width: 896, positive_prompt: 'x' })).not.toThrow();
  });
});

describe('SDXL production: single modules', () => {
  const w = wf('sienna-sdxl-production');

  it('face only: keeps IPAdapter, drops pose + img2img', () => {
    let g = w.graph;
    let b = w.bindings;
    ({ graph: g, bindings: b } = pruneModule(g, b, 'pose_image'));
    ({ graph: g, bindings: b } = pruneModule(g, b, 'init_image'));
    expect(g['12'].class_type).toBe('IPAdapterFaceID');
    expect(g['40'].inputs.model).toEqual(['12', 0]);
    expect(g['40'].inputs.positive).toEqual(['3', 0]);
    expect(g['21']).toBeUndefined(); // ControlNetLoader garbage-collected
  });

  it('img2img kept: VAEEncode feeds the sampler; empty latent survives pruning, final GC drops it', () => {
    const { graph } = pruneModule(w.graph, w.bindings, 'pose_image');
    expect(graph['40'].inputs.latent_image).toEqual(['32', 0]);
    expect(graph['33']).toBeDefined(); // a later init_image prune may still need it
    expect(garbageCollect(graph)['33']).toBeUndefined();
  });

  it('pruning order does not matter', () => {
    const orders: (typeof MODULE_KEYS)[number][][] = [
      ['face_reference_image', 'init_image', 'pose_image'],
      ['init_image', 'pose_image', 'face_reference_image'],
      ['pose_image', 'face_reference_image', 'init_image'],
    ];
    const results = orders.map((order) => {
      let g = w.graph;
      let b = w.bindings;
      for (const k of order) ({ graph: g, bindings: b } = pruneModule(g, b, k));
      return garbageCollect(g);
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('reports module node sets', () => {
    expect(moduleNodeIds(w.graph, w.bindings, 'face_reference_image').sort()).toEqual(['10', '11', '12']);
    expect(moduleNodeIds(w.graph, w.bindings, 'pose_image').sort()).toEqual(['20', '21', '22']);
    expect(moduleNodeIds(w.graph, w.bindings, 'init_image').sort()).toEqual(['30', '31', '32']);
  });
});

describe('Flux production', () => {
  const w = wf('sienna-flux-production');
  it('all modules prunable; result is a valid Flux txt2img graph', () => {
    for (const k of MODULE_KEYS) expect(canPrune(w.graph, w.bindings, k)).toBe(true);
    const { g, b } = pruneAll(w);
    expect(classes(g)).toEqual(
      ['CLIPTextEncode', 'CLIPTextEncode', 'DualCLIPLoader', 'EmptySD3LatentImage', 'FluxGuidance', 'KSampler', 'LoraLoader', 'SaveImage', 'UNETLoader', 'VAEDecode', 'VAELoader'].sort(),
    );
    expect(g['40'].inputs.model).toEqual(['4', 0]);
    expect(g['40'].inputs.positive).toEqual(['7', 0]);
    expect(validateBindings(g, b)).toEqual([]);
  });

  it('PuLID loaders belong to the face module', () => {
    expect(moduleNodeIds(w.graph, w.bindings, 'face_reference_image').sort()).toEqual(['10', '11', '12', '13', '14']);
    expect(moduleNodeIds(w.graph, w.bindings, 'pose_image').sort()).toEqual(['20', '21', '22', '23']);
  });
});

describe('pruning safety', () => {
  it('refuses to prune when the sampler depends on the image with no bypass', () => {
    const g: ComfyGraph = {
      '1': { class_type: 'LoadImage', inputs: { image: 'x.png' } },
      '2': { class_type: 'VAEEncode', inputs: { pixels: ['1', 0], vae: ['9', 2] } },
      '3': { class_type: 'KSampler', inputs: { latent_image: ['2', 0], seed: 0 } },
      '4': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
      '9': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a' } },
    };
    // no Empty*LatentImage to fall back to
    expect(() => pruneModule(g, { init_image: [{ nodeId: '1', inputName: 'image' }] }, 'init_image')).toThrow(/Cannot remove/);
  });

  it('garbage-collects nodes no output depends on', () => {
    const g: ComfyGraph = {
      a: { class_type: 'X', inputs: {} },
      b: { class_type: 'SaveImage', inputs: { images: ['c', 0] } },
      c: { class_type: 'Y', inputs: {} },
    };
    expect(Object.keys(garbageCollect(g)).sort()).toEqual(['b', 'c']);
  });
});
