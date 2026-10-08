import type { ComfyGraph } from '../types';
import type { ComfyBackend } from './client';

/** Inputs that name a model file on the server (detectors, ControlNets, IPAdapters, CLIP vision). */
const MODEL_FILE_INPUTS = ['model_name', 'control_net_name', 'ipadapter_file', 'clip_name'];

/**
 * For nodes that load a model by filename (face detector, ControlNet,
 * IPAdapter, CLIP vision …), check the file is in the server's list. An empty
 * list means the model folder is empty, which is reported as missing too.
 * Returns a reason, or null if fine (or if the server can't be asked).
 */
export async function missingModelFile(backend: ComfyBackend, graph: ComfyGraph, ids: string[]): Promise<string | null> {
  for (const id of ids) {
    const node = graph[id];
    if (!node) continue;
    for (const input of MODEL_FILE_INPUTS) {
      const file = node.inputs[input];
      if (typeof file !== 'string') continue;
      try {
        const info = await backend.nodeInfo(node.class_type);
        const spec = info?.input?.required?.[input] ?? info?.input?.optional?.[input];
        // Only combo inputs list files; anything else (or an unknown node) can't be checked here.
        if (!isComboSpec(spec)) continue;
        const choices = comboOptions(spec);
        if (!choices.includes(file)) {
          return choices.length
            ? `model file “${file}” is not on the server`
            : `model file “${file}” is not on the server (no ${input.replace(/_/g, ' ')} files are installed for ${node.class_type})`;
        }
      } catch {
        // unreachable server → let /prompt report the real problem
      }
    }
  }
  return null;
}

const isComboSpec = (spec: unknown) =>
  Array.isArray(spec) && (Array.isArray(spec[0]) || (spec[0] === 'COMBO' && !!spec[1] && Array.isArray((spec[1] as any).options)));

/** Parse both the legacy `[["a","b"]]` and newer `["COMBO", {options:[...]}]` input specs. */
export function comboOptions(spec: unknown): string[] {
  if (!Array.isArray(spec)) return [];
  if (Array.isArray(spec[0])) return spec[0].map(String);
  if (spec[0] === 'COMBO' && spec[1] && Array.isArray((spec[1] as any).options)) return (spec[1] as any).options.map(String);
  return [];
}
