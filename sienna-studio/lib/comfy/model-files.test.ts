import { describe, expect, it } from 'vitest';
import { builtinWorkflows } from './builtin-workflows';
import type { ComfyBackend, NodeInfo } from './client';
import { missingModelFile } from './model-files';
import { moduleNodeIds } from './modules';

/** Backend whose /object_info lists the given files per input name. */
function fakeBackend(files: Record<string, string[]>, legacy = false): ComfyBackend {
  return {
    nodeInfo: async (cls: string): Promise<NodeInfo | null> => ({
      input: {
        required: Object.fromEntries(
          Object.entries(files).map(([k, v]) => [k, legacy ? [v] : ['COMBO', { options: v }]]),
        ),
      },
      python_module: cls,
    }),
  } as unknown as ComfyBackend;
}

const w = builtinWorkflows().find((x) => x.id === 'sienna-sdxl-production')!;
const poseIds = moduleNodeIds(w.graph, w.bindings, 'pose_image');
const outfitIds = moduleNodeIds(w.graph, w.bindings, 'outfit_reference_image');

describe('missingModelFile (pose-reference bug)', () => {
  it('empty ControlNet folder → missing (the old check treated an empty list as fine)', async () => {
    const r = await missingModelFile(fakeBackend({ control_net_name: [] }), w.graph, poseIds);
    expect(r).toMatch(/sdxl_openpose\.safetensors.*not on the server.*no control net name files/);
  });

  it('a different ControlNet installed → missing', async () => {
    const r = await missingModelFile(fakeBackend({ control_net_name: ['other.safetensors'] }, true), w.graph, poseIds);
    expect(r).toBe('model file “sdxl_openpose.safetensors” is not on the server');
  });

  it('the right file installed → ok', async () => {
    expect(await missingModelFile(fakeBackend({ control_net_name: ['sdxl_openpose.safetensors'] }), w.graph, poseIds)).toBeNull();
  });

  it('outfit module checks the IPAdapter, CLIP vision and segmentation files', async () => {
    const all = {
      ipadapter_file: ['ip-adapter-plus_sdxl_vit-h.safetensors'],
      clip_name: ['CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors'],
      model_name: ['bbox/face_yolov8m.pt', 'segm/person_yolov8m-seg.pt'],
    };
    expect(await missingModelFile(fakeBackend(all), w.graph, outfitIds)).toBeNull();
    expect(await missingModelFile(fakeBackend({ ...all, model_name: ['bbox/face_yolov8m.pt'] }), w.graph, outfitIds)).toMatch(/person_yolov8m-seg/);
    expect(await missingModelFile(fakeBackend({ ...all, ipadapter_file: [] }), w.graph, outfitIds)).toMatch(/ip-adapter-plus_sdxl_vit-h/);
  });

  it('non-combo inputs and unreachable servers are not reported', async () => {
    const plain = { nodeInfo: async () => ({ input: { required: { control_net_name: ['STRING', {}] } } }) } as unknown as ComfyBackend;
    expect(await missingModelFile(plain, w.graph, poseIds)).toBeNull();
    const down = { nodeInfo: async () => { throw new Error('offline'); } } as unknown as ComfyBackend;
    expect(await missingModelFile(down, w.graph, poseIds)).toBeNull();
  });
});
