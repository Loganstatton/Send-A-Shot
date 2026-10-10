import { describe, expect, it } from 'vitest';
import { applyBindings, autoDetectBindings, bypassLora, capabilities, chainLora, injectLora, parseWorkflowJson, validateBindings } from './adapter';
import { builtinWorkflows } from './builtin-workflows';
import type { ComfyGraph } from '../types';

const NO_LORA: ComfyGraph = {
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  '3': {
    class_type: 'KSampler',
    inputs: { seed: 0, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'x', images: ['8', 0] } },
};

describe('built-in workflows', () => {
  for (const wf of builtinWorkflows()) {
    it(`${wf.id}: bindings point at real value inputs`, () => {
      expect(validateBindings(wf.graph, wf.bindings)).toEqual([]);
    });
    it(`${wf.id}: auto-detect agrees on the core controls`, () => {
      const auto = autoDetectBindings(wf.graph);
      for (const key of ['positive_prompt', 'negative_prompt', 'seed', 'lora_name', 'checkpoint'] as const) {
        expect(auto[key]?.[0]).toEqual(wf.bindings[key]?.[0]);
      }
    });
  }

  it('detects face/pose/init LoadImage roles in the SDXL production graph', () => {
    const wf = builtinWorkflows().find((w) => w.id === 'sienna-sdxl-production')!;
    const auto = autoDetectBindings(wf.graph);
    expect(auto.face_reference_image).toEqual([{ nodeId: '10', inputName: 'image' }]);
    expect(auto.pose_image).toEqual([{ nodeId: '20', inputName: 'image' }]);
    expect(auto.init_image).toEqual([{ nodeId: '30', inputName: 'image' }]);
    expect(capabilities(auto)).toMatchObject({ faceReference: true, pose: true, lora: true, img2img: true });
  });

  it('detects Flux guidance and PuLID weight in the Flux production graph', () => {
    const wf = builtinWorkflows().find((w) => w.id === 'sienna-flux-production')!;
    const auto = autoDetectBindings(wf.graph);
    expect(auto.guidance).toEqual([{ nodeId: '7', inputName: 'guidance' }]);
    expect(auto.positive_prompt).toEqual([{ nodeId: '5', inputName: 'text' }]);
    expect(auto.face_strength).toEqual([{ nodeId: '14', inputName: 'weight' }]);
    expect(auto.face_reference_image).toEqual([{ nodeId: '10', inputName: 'image' }]);
  });
});

describe('applyBindings', () => {
  it('writes values without mutating the template', () => {
    const b = autoDetectBindings(NO_LORA);
    const { graph, unbound } = applyBindings(NO_LORA, b, { positive_prompt: 'hello', seed: 42, lora_name: 'x' });
    expect(graph['6'].inputs.text).toBe('hello');
    expect(graph['3'].inputs.seed).toBe(42);
    expect(NO_LORA['6'].inputs.text).toBe('');
    expect(unbound).toEqual(['lora_name']);
  });

  it('refuses to overwrite a link', () => {
    expect(() => applyBindings(NO_LORA, { seed: [{ nodeId: '3', inputName: 'model' }] }, { seed: 1 })).toThrow(/link/);
  });
});

describe('injectLora / bypassLora', () => {
  it('splices a LoraLoader between checkpoint and consumers', () => {
    const { graph, nodeId } = injectLora(NO_LORA, 'sienna.safetensors', 0.8, 0.7);
    expect(graph[nodeId].class_type).toBe('LoraLoader');
    expect(graph[nodeId].inputs.model).toEqual(['4', 0]);
    expect(graph['3'].inputs.model).toEqual([nodeId, 0]);
    expect(graph['6'].inputs.clip).toEqual([nodeId, 1]);
    // VAE output (slot 2) must still come from the checkpoint
    expect(graph['8'].inputs.vae).toEqual(['4', 2]);
  });

  it('bypass restores original wiring', () => {
    const { graph, nodeId } = injectLora(NO_LORA, 'a', 1, 1);
    const back = bypassLora(graph, nodeId);
    expect(back).toEqual(NO_LORA);
  });

  it('uses LoraLoaderModelOnly when there is no CLIP source', () => {
    const g: ComfyGraph = {
      '1': { class_type: 'UNETLoader', inputs: { unet_name: 'f.safetensors', weight_dtype: 'default' } },
      '2': { class_type: 'KSampler', inputs: { model: ['1', 0], seed: 0 } },
    };
    const { graph, nodeId } = injectLora(g, 'l', 1, 1);
    expect(graph[nodeId].class_type).toBe('LoraLoaderModelOnly');
  });
});

describe('chainLora', () => {
  it('stacks LoRAs after Sienna in order, keeping the VAE on the checkpoint', () => {
    const sienna = injectLora(NO_LORA, 'sienna.safetensors', 1, 1);
    const a = chainLora(sienna.graph, sienna.nodeId, 'micro.safetensors', 0.75, 'Style pack: Micro bikini');
    const b = chainLora(a.graph, a.nodeId, 'real.safetensors', 0.4, 'Style pack: Real-photo look');
    const g = b.graph;
    expect(g[a.nodeId].inputs).toMatchObject({ model: [sienna.nodeId, 0], clip: [sienna.nodeId, 1], lora_name: 'micro.safetensors', strength_model: 0.75, strength_clip: 0.75 });
    expect(g[b.nodeId].inputs).toMatchObject({ model: [a.nodeId, 0], clip: [a.nodeId, 1] });
    expect(g['3'].inputs.model).toEqual([b.nodeId, 0]);
    expect(g['6'].inputs.clip).toEqual([b.nodeId, 1]);
    expect(g['7'].inputs.clip).toEqual([b.nodeId, 1]);
    expect(g['8'].inputs.vae).toEqual(['4', 2]);
    expect(g[sienna.nodeId].inputs.model).toEqual(['4', 0]);
  });

  it('refuses to chain after a node that is not a LoraLoader', () => {
    expect(() => chainLora(NO_LORA, '4', 'x', 1, 't')).toThrow(/not a LoraLoader/);
  });
});

describe('parseWorkflowJson', () => {
  it('rejects UI-format exports with a helpful message', () => {
    expect(() => parseWorkflowJson({ nodes: [], links: [] })).toThrow(/Export \(API\)/);
  });
  it('accepts { prompt: graph } wrappers', () => {
    expect(Object.keys(parseWorkflowJson({ prompt: NO_LORA }))).toHaveLength(7);
  });
});
