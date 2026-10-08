import { describe, expect, it } from 'vitest';
import { applyBindings, validateBindings } from './adapter';
import { builtinWorkflows } from './builtin-workflows';
import { applyQualityOptions } from './quality';
import { bypassNode, bypassNodeIds, canPrune, filterBindings, garbageCollect, moduleNodeIds, MODULE_KEYS, pruneModule } from './modules';
import type { ComfyGraph, WorkflowTemplate } from '../types';

// The production template carries optional Phase 1 nodes; with every option off they are removed.
const wf = (id: string): WorkflowTemplate => {
  const w = builtinWorkflows().find((x) => x.id === id)!;
  const graph = applyQualityOptions(w.graph, w.bindings, {});
  return { ...w, graph, bindings: filterBindings(graph, w.bindings) };
};
const classes = (g: ComfyGraph) => Object.values(g).map((n) => n.class_type).sort();

function pruneAll(w: WorkflowTemplate) {
  let g = w.graph;
  let b = w.bindings;
  for (const k of MODULE_KEYS) ({ graph: g, bindings: b } = pruneModule(g, b, k));
  const refine = b.face_refine_denoise?.[0]?.nodeId;
  if (refine) {
    g = bypassNode(g, refine);
    b = filterBindings(g, b);
  }
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

  it('face only: keeps IPAdapter, drops pose + img2img + outfit', () => {
    let g = w.graph;
    let b = w.bindings;
    ({ graph: g, bindings: b } = pruneModule(g, b, 'pose_image'));
    ({ graph: g, bindings: b } = pruneModule(g, b, 'init_image'));
    ({ graph: g, bindings: b } = pruneModule(g, b, 'outfit_reference_image'));
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
    expect(moduleNodeIds(w.graph, w.bindings, 'pose_image').sort()).toEqual(['20', '21', '22', '23']);
    expect(moduleNodeIds(w.graph, w.bindings, 'init_image').sort()).toEqual(['30', '31', '32']);
  });
});

describe('Flux production', () => {
  const w = wf('sienna-flux-production');
  it('all modules prunable; result is a valid Flux txt2img graph', () => {
    for (const k of MODULE_KEYS) expect(canPrune(w.graph, w.bindings, k)).toBe(k !== 'outfit_reference_image'); // Flux has no outfit branch
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

describe('SDXL production: small-face refinement pass', () => {
  const w = wf('sienna-sdxl-production');
  const refine = w.bindings.face_refine_denoise![0].nodeId;

  it('refines the decoded image with the plain LoRA model and prompts (no face reference)', () => {
    const n = w.graph[refine];
    expect(n.class_type).toBe('FaceDetailer');
    expect(n.inputs.image).toEqual(['41', 0]);
    expect(n.inputs.model).toEqual(['2', 0]);
    expect(n.inputs.positive).toEqual(['3', 0]);
    expect(n.inputs.negative).toEqual(['4', 0]);
    expect(n.inputs.force_inpaint).toBe(false); // large faces are skipped
    expect(w.graph['42'].inputs.images).toEqual([refine, 0]);
  });

  it('shares seed/steps/cfg/sampler/scheduler with the first pass', () => {
    for (const k of ['seed', 'steps', 'cfg', 'sampler', 'scheduler'] as const) {
      expect(w.bindings[k]!.map((r) => r.nodeId)).toEqual(['40', refine]);
    }
  });

  it('bypassing it wires SaveImage to the decoder and drops the detector', () => {
    const g = bypassNode(w.graph, refine);
    expect(g[refine]).toBeUndefined();
    expect(g['50']).toBeUndefined();
    expect(g['42'].inputs.images).toEqual(['41', 0]);
    expect(bypassNodeIds(w.graph, refine).sort()).toEqual(['50', refine].sort());
    expect(validateBindings(g, filterBindings(g, w.bindings))).toEqual([]);
  });

  it('keeps optional-module orphans when bypassed (the empty latent survives)', () => {
    const g = bypassNode(w.graph, refine);
    expect(g['33']).toBeDefined();
  });

  it('refuses to bypass a node without a pass-through', () => {
    expect(() => bypassNode(w.graph, '40')).toThrow();
  });
});

describe('SDXL production: outfit reference module', () => {
  const w = wf('sienna-sdxl-production');
  const prune = (keys: ('init_image' | 'face_reference_image' | 'pose_image' | 'outfit_reference_image')[]) => {
    let g = w.graph;
    let b = w.bindings;
    for (const k of keys) ({ graph: g, bindings: b } = pruneModule(g, b, k));
    return { g, b };
  };

  it('is optional and prunable', () => {
    expect(w.optionalModules).toContain('outfit_reference_image');
    expect(canPrune(w.graph, w.bindings, 'outfit_reference_image')).toBe(true);
  });

  it('outfit pruned: the sampler goes straight to the FaceID chain and every outfit node is removed', () => {
    const { g, b } = prune(['outfit_reference_image']);
    expect(g['40'].inputs.model).toEqual(['12', 0]);
    for (const id of ['60', '61', '62', '63', '64', '65', '66', '67', '68', '69', '70', '71', '72']) expect(g[id]).toBeUndefined();
    expect(b.outfit_strength).toBeUndefined();
    expect(validateBindings(g, b)).toEqual([]);
  });

  it('outfit only (face reference pruned): IPAdapterAdvanced sits on the plain Sienna LoRA model', () => {
    const { g, b } = prune(['face_reference_image', 'pose_image', 'init_image']);
    expect(g['72'].class_type).toBe('IPAdapterAdvanced');
    expect(g['72'].inputs.model).toEqual(['2', 0]);
    expect(g['40'].inputs.model).toEqual(['72', 0]);
    expect(g['11']).toBeUndefined();
    expect(validateBindings(g, b)).toEqual([]);
    const out = applyBindings(g, b, { outfit_reference_image: 'sienna/o.png', outfit_strength: 0.9, outfit_weight_type: 'linear' }).graph;
    expect(out['60'].inputs.image).toBe('sienna/o.png');
    expect(out['72'].inputs.weight).toBe(0.9);
    expect(out['72'].inputs.weight_type).toBe('linear');
  });

  it('the face-refinement pass never sees the outfit conditioning', () => {
    const { g } = prune(['face_reference_image']);
    expect(g['51'].inputs.model).toEqual(['2', 0]);
  });

  it('only clothing reaches the IPAdapter: the reference image goes through the person-minus-face mask first', () => {
    const g = w.graph;
    expect(g['72'].inputs.image).toEqual(['69', 0]);
    expect(g['69'].inputs.image).toEqual(['68', 0]);
    expect(g['68'].inputs.mask).toEqual(['65', 0]);
    expect(g['65'].inputs.operation).toBe('subtract');
    expect(g['65'].inputs.source).toEqual(['64', 0]); // face/hair box removed from the person mask
  });

  it('outfit node ids belong to the module (pruned together)', () => {
    expect(moduleNodeIds(w.graph, w.bindings, 'outfit_reference_image').sort()).toEqual(
      ['60', '61', '62', '63', '64', '65', '66', '67', '68', '69', '70', '71', '72'].sort(),
    );
  });
});

describe('SDXL production: pose module', () => {
  const w = wf('sienna-sdxl-production');
  it('only the extracted skeleton reaches the ControlNet', () => {
    expect(w.graph['22'].inputs.image).toEqual(['23', 0]);
    expect(w.graph['23'].class_type).toBe('DWPreprocessor');
    expect(w.graph['23'].inputs.detect_face).toBe('disable');
  });
  it('pruning pose removes the extractor, loader and apply node', () => {
    const { graph: g } = pruneModule(w.graph, w.bindings, 'pose_image');
    for (const id of ['20', '21', '22', '23']) expect(g[id]).toBeUndefined();
    expect(g['40'].inputs.positive).toEqual(['3', 0]);
  });
});
