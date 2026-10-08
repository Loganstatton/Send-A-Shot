/**
 * Phase 1 quality options
 * =======================
 *
 * The production SDXL template carries optional nodes that are *unwired* by default:
 *
 *   pose fit        ImagePadForOutpaint between the pose photo and DWPose
 *   pose retarget   SiennaPoseRetarget between DWPose and the ControlNet
 *   refinement      decode → upscale → encode → low-denoise KSampler, before the final decode
 *   garment mode    the clothing adapter takes the uploaded garment-only crop directly
 *
 * applyQualityOptions() wires in the ones that are enabled and deletes the rest, so with
 * everything off the graph is exactly the previous production graph. Node ids are found
 * through the bindings (pose_pad_left, pose_retarget_strength, hires_denoise …), not
 * hard-coded, so edited copies of the workflow keep working as long as their mapping is set.
 */

import type { ComfyGraph, ControlKey, WorkflowBindings } from '../types';
import { cloneGraph } from './adapter';

type Link = [string, number];
const isLink = (v: unknown): v is Link => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';
const same = (a: Link, b: Link) => a[0] === b[0] && a[1] === b[1];

export interface QualityOptions {
  posePad?: { left: number; top: number; right: number; bottom: number } | null;
  poseRetarget?: number;
  hires?: boolean;
  /** Feed the clothing adapter the uploaded garment-only crop (skip in-graph person isolation). */
  garmentImage?: boolean;
}

const nodeOf = (b: WorkflowBindings, key: ControlKey) => b[key]?.[0]?.nodeId;

function consumers(g: ComfyGraph, from: Link, except: Set<string>) {
  const out: { id: string; input: string }[] = [];
  for (const [id, n] of Object.entries(g)) {
    if (except.has(id)) continue;
    for (const [k, v] of Object.entries(n.inputs)) if (isLink(v) && same(v, from)) out.push({ id, input: k });
  }
  return out;
}

function hasConsumers(g: ComfyGraph, id: string) {
  return Object.values(g).some((n) => Object.values(n.inputs).some((v) => isLink(v) && v[0] === id));
}

/**
 * Delete `id` if nothing consumes it, then any of its inputs that are now unused — but only
 * along that chain, so unrelated orphans (e.g. the empty latent kept for img2img) survive.
 */
export function dropUnused(g: ComfyGraph, id: string) {
  if (!g[id] || hasConsumers(g, id)) return;
  const inputs = Object.values(g[id].inputs).filter(isLink).map((l) => l[0]);
  delete g[id];
  for (const src of new Set(inputs)) dropUnused(g, src);
}

/** Point every consumer of `from` (except the nodes in `except`) at `to`. */
function rewire(g: ComfyGraph, from: Link, to: Link, except: string[]) {
  for (const c of consumers(g, from, new Set(except))) g[c.id].inputs[c.input] = to;
}

export function applyQualityOptions(graph: ComfyGraph, bindings: WorkflowBindings, o: QualityOptions): ComfyGraph {
  const g = cloneGraph(graph);

  // ── Pose fit: pad the photo before the pose detector ──
  const padId = nodeOf(bindings, 'pose_pad_left');
  if (padId && g[padId]) {
    const src = g[padId].inputs.image;
    if (o.posePad && isLink(src)) {
      Object.assign(g[padId].inputs, o.posePad, { feathering: 0 });
      rewire(g, src, [padId, 0], [padId]);
    } else {
      dropUnused(g, padId);
    }
  }

  // ── Pose retarget: skeleton image comes from SiennaPoseRetarget instead of DWPose ──
  const retId = nodeOf(bindings, 'pose_retarget_strength');
  if (retId && g[retId]) {
    const kp = g[retId].inputs.pose_keypoint;
    if ((o.poseRetarget ?? 0) > 0 && isLink(kp)) {
      rewire(g, [kp[0], 0], [retId, 0], [retId]);
    } else {
      dropUnused(g, retId);
    }
  }

  // ── Refinement pass: the final decode reads the refined latent ──
  const hiresId = nodeOf(bindings, 'hires_denoise');
  if (hiresId && g[hiresId]) {
    const firstDecode = upstream(g, hiresId).find((id) => g[id].class_type === 'VAEDecode');
    const firstLatent = firstDecode ? (g[firstDecode].inputs.samples as Link | undefined) : undefined;
    if (o.hires && firstDecode && isLink(firstLatent)) {
      // every other reader of the first-pass latent (the final VAEDecode) now reads the refined one
      rewire(g, firstLatent, [hiresId, 0], [firstDecode]);
    } else {
      dropUnused(g, hiresId);
    }
  }

  // ── Garment-only crop: the clothing adapter's prep node reads the outfit image directly ──
  const outfitId = nodeOf(bindings, 'outfit_reference_image');
  if (o.garmentImage && outfitId && g[outfitId]) {
    const prep = Object.entries(g).find(([, n]) => n.class_type === 'PrepImageForClipVision');
    const prepSrc = prep?.[1].inputs.image;
    if (prep && isLink(prepSrc) && prepSrc[0] !== outfitId) {
      prep[1].inputs.image = [outfitId, 0];
      dropUnused(g, prepSrc[0]);
    }
  }
  return g;
}

/** Node ids upstream of `id`, nearest first (breadth-first along input links). */
function upstream(g: ComfyGraph, id: string): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const v of Object.values(g[cur]?.inputs ?? {})) {
      if (isLink(v) && !seen.has(v[0]) && g[v[0]]) {
        seen.add(v[0]);
        out.push(v[0]);
        queue.push(v[0]);
      }
    }
  }
  return out;
}

/**
 * Padding that makes a (w × h) photo match the output aspect ratio, split evenly and rounded
 * to the pad node's step of 8. Returns null when no padding is needed or the size is unknown.
 */
export function posePadding(photoW: number | undefined, photoH: number | undefined, outW: number, outH: number) {
  if (!photoW || !photoH || !outW || !outH) return null;
  const target = outW / outH;
  const r8 = (n: number) => Math.max(0, Math.round(n / 8) * 8);
  if (Math.abs(photoW / photoH - target) < 0.01) return null;
  if (photoW / photoH < target) {
    const total = photoH * target - photoW;
    const left = r8(total / 2);
    return { left, right: r8(total - left), top: 0, bottom: 0 };
  }
  const total = photoW / target - photoH;
  const top = r8(total / 2);
  return { left: 0, right: 0, top, bottom: r8(total - top) };
}
