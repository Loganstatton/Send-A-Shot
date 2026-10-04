/**
 * ComfyUI backend client (server-side only).
 *
 * Uses only ComfyUI's built-in HTTP API (server.py in the ComfyUI repo):
 *   GET  /system_stats             – health / connection test
 *   GET  /object_info/{NodeClass}  – enum choices (checkpoints, LoRAs, samplers…)
 *   POST /upload/image             – multipart upload into ComfyUI's input/ folder
 *   POST /prompt                   – queue an API-format graph → { prompt_id }
 *   GET  /queue                    – running / pending jobs
 *   GET  /history/{prompt_id}      – outputs once finished
 *   GET  /view?filename&subfolder&type – fetch an output image
 *   POST /interrupt                – stop the running job
 *
 * Any reachable host that exposes this API works — any cloud GPU provider,
 * your own PC, or a managed service that proxies the native API. Nothing here
 * is provider-specific; auth is via COMFYUI_API_KEY / COMFYUI_EXTRA_HEADERS.
 * A provider with a *different* API (a bespoke serverless endpoint) needs a
 * new class implementing `ComfyBackend` — see README “Other backends”.
 */

import 'server-only';
import { encodePng, mockPortrait } from '../server/png';
import type { ComfyGraph } from '../types';

export interface OutputImageRef {
  filename: string;
  subfolder: string;
  type: string;
  nodeId: string;
}

export type JobState =
  | { state: 'pending'; position: number }
  | { state: 'running' }
  | { state: 'done'; images: OutputImageRef[] }
  | { state: 'error'; message: string; details?: unknown }
  | { state: 'unknown' };

export interface SystemInfo {
  ok: true;
  backend: 'comfyui' | 'mock';
  comfyuiVersion?: string;
  pythonVersion?: string;
  devices: { name: string; type: string; vramTotal?: number; vramFree?: number }[];
}

export interface ComfyBackend {
  readonly kind: 'comfyui' | 'mock';
  systemInfo(): Promise<SystemInfo>;
  /** Choices for one input of a node class, e.g. ("LoraLoader", "lora_name"). */
  inputChoices(nodeClass: string, inputName: string): Promise<string[]>;
  /** /object_info entry for a node class, or null if the class is not installed. */
  nodeInfo(nodeClass: string): Promise<NodeInfo | null>;
  uploadImage(bytes: Buffer, filename: string, mime: string): Promise<string>;
  queuePrompt(graph: ComfyGraph, clientId: string): Promise<{ promptId: string }>;
  jobState(promptId: string, outputNodeIds: string[]): Promise<JobState>;
  fetchImage(ref: OutputImageRef): Promise<{ bytes: Buffer; mime: string }>;
  interrupt(): Promise<void>;
}

export interface NodeInfo {
  input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> };
  output?: string[];
  python_module?: string;
}

export class ComfyError extends Error {
  constructor(
    message: string,
    public status = 502,
    public details?: unknown,
  ) {
    super(message);
  }
}

// ── Real ComfyUI ────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (process.env.COMFYUI_API_KEY) h.Authorization = `Bearer ${process.env.COMFYUI_API_KEY}`;
  if (process.env.COMFYUI_EXTRA_HEADERS) {
    try {
      Object.assign(h, JSON.parse(process.env.COMFYUI_EXTRA_HEADERS));
    } catch {
      console.warn('COMFYUI_EXTRA_HEADERS is not valid JSON — ignored.');
    }
  }
  return h;
}

// /object_info results cached per server URL (5 min) so diagnostics and
// generation don't re-query node definitions on every request.
const OBJECT_INFO_TTL = 5 * 60_000;
const gc = globalThis as unknown as { __siennaObjectInfo?: Map<string, Map<string, { at: number; data: NodeInfo | null }>> };
const objectInfoCaches = (gc.__siennaObjectInfo ??= new Map());

export class RealComfy implements ComfyBackend {
  readonly kind = 'comfyui' as const;
  private base: string;
  private objectInfoCache: Map<string, { at: number; data: NodeInfo | null }>;

  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, '');
    if (!objectInfoCaches.has(this.base)) objectInfoCaches.set(this.base, new Map());
    this.objectInfoCache = objectInfoCaches.get(this.base)!;
  }

  private async req(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20000);
    try {
      const res = await fetch(this.base + path, {
        ...init,
        headers: { ...authHeaders(), ...(init.headers as Record<string, string>) },
        signal: ctrl.signal,
        cache: 'no-store',
      });
      return res;
    } catch (e: any) {
      const reason = e?.name === 'AbortError' ? 'timed out' : e?.cause?.code || e?.message || 'network error';
      throw new ComfyError(`Could not reach ComfyUI at ${this.base} (${reason}).`, 502);
    } finally {
      clearTimeout(timer);
    }
  }

  private async json<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const res = await this.req(path, init);
    const text = await res.text();
    if (!res.ok) {
      let details: unknown = text;
      try {
        details = JSON.parse(text);
      } catch {}
      if (res.status === 401 || res.status === 403) {
        throw new ComfyError(`ComfyUI rejected the request (HTTP ${res.status}). Check COMFYUI_API_KEY / COMFYUI_EXTRA_HEADERS.`, res.status, details);
      }
      throw new ComfyError(`ComfyUI ${path} returned HTTP ${res.status}.`, res.status >= 500 ? 502 : 400, details);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ComfyError(`ComfyUI ${path} returned non-JSON. Is the URL pointing at ComfyUI (port 8188) and not a login page?`, 502);
    }
  }

  async systemInfo(): Promise<SystemInfo> {
    const s = await this.json<any>('/system_stats', { timeoutMs: 10000 });
    return {
      ok: true,
      backend: 'comfyui',
      comfyuiVersion: s?.system?.comfyui_version,
      pythonVersion: s?.system?.python_version,
      devices: (s?.devices ?? []).map((d: any) => ({ name: d.name, type: d.type, vramTotal: d.vram_total, vramFree: d.vram_free })),
    };
  }

  async nodeInfo(nodeClass: string): Promise<NodeInfo | null> {
    const cached = this.objectInfoCache.get(nodeClass);
    if (cached && Date.now() - cached.at < OBJECT_INFO_TTL) return cached.data;
    // ComfyUI returns {} for classes that aren't installed.
    const all = await this.json<Record<string, NodeInfo>>(`/object_info/${encodeURIComponent(nodeClass)}`);
    const info = all[nodeClass] ?? null;
    this.objectInfoCache.set(nodeClass, { at: Date.now(), data: info });
    return info;
  }

  async inputChoices(nodeClass: string, inputName: string): Promise<string[]> {
    const info = await this.nodeInfo(nodeClass);
    if (!info) return [];
    const spec = info.input?.required?.[inputName] ?? info.input?.optional?.[inputName];
    return comboOptions(spec);
  }

  async uploadImage(bytes: Buffer, filename: string, mime: string): Promise<string> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(bytes)], { type: mime }), filename);
    form.append('type', 'input');
    form.append('subfolder', 'sienna');
    form.append('overwrite', 'true');
    const r = await this.json<{ name: string; subfolder?: string }>('/upload/image', { method: 'POST', body: form, timeoutMs: 60000 });
    // LoadImage expects "subfolder/name" when a subfolder is used.
    return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
  }

  async queuePrompt(graph: ComfyGraph, clientId: string) {
    const res = await this.req('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
      timeoutMs: 30000,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.prompt_id) {
      throw new ComfyError(describePromptError(body) || `ComfyUI /prompt returned HTTP ${res.status}.`, 400, body);
    }
    return { promptId: body.prompt_id as string };
  }

  async jobState(promptId: string, outputNodeIds: string[]): Promise<JobState> {
    const hist = await this.json<Record<string, any>>(`/history/${encodeURIComponent(promptId)}`);
    const entry = hist[promptId];
    if (entry) {
      const status = entry.status;
      if (status?.status_str === 'error') {
        const err = (status.messages ?? []).find((m: any) => m[0] === 'execution_error')?.[1];
        const msg = err
          ? `${err.node_type ?? 'Node'} (node ${err.node_id}): ${err.exception_type ? err.exception_type + ': ' : ''}${err.exception_message ?? 'execution error'}`
          : 'ComfyUI reported an execution error.';
        const details = err
          ? { node_id: err.node_id, node_type: err.node_type, exception_type: err.exception_type, exception_message: err.exception_message, traceback: (err.traceback ?? []).slice(-6) }
          : status;
        return { state: 'error', message: msg.trim(), details };
      }
      if (status && status.completed === false && status.status_str !== 'success') return { state: 'running' };
      const images: OutputImageRef[] = [];
      for (const [nodeId, out] of Object.entries<any>(entry.outputs ?? {})) {
        if (outputNodeIds.length && !outputNodeIds.includes(nodeId)) continue;
        for (const img of out.images ?? []) {
          images.push({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output', nodeId });
        }
      }
      // Prefer saved outputs over temp previews when both exist.
      const saved = images.filter((i) => i.type === 'output');
      return { state: 'done', images: saved.length ? saved : images };
    }
    const q = await this.json<{ queue_running: any[]; queue_pending: any[] }>('/queue');
    if (q.queue_running?.some((item) => item[1] === promptId)) return { state: 'running' };
    const idx = (q.queue_pending ?? []).sort((a, b) => a[0] - b[0]).findIndex((item) => item[1] === promptId);
    if (idx >= 0) return { state: 'pending', position: idx + 1 };
    return { state: 'unknown' };
  }

  async fetchImage(ref: OutputImageRef) {
    const qs = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type });
    const res = await this.req(`/view?${qs}`, { timeoutMs: 60000 });
    if (!res.ok) throw new ComfyError(`Could not download ${ref.filename} from ComfyUI (HTTP ${res.status}).`);
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/png' };
  }

  async interrupt() {
    await this.req('/interrupt', { method: 'POST' });
  }
}

/** Parse both the legacy `[["a","b"]]` and newer `["COMBO", {options:[...]}]` input specs. */
export function comboOptions(spec: unknown): string[] {
  if (!Array.isArray(spec)) return [];
  if (Array.isArray(spec[0])) return spec[0].map(String);
  if (spec[0] === 'COMBO' && spec[1] && Array.isArray((spec[1] as any).options)) return (spec[1] as any).options.map(String);
  return [];
}

function describePromptError(body: any): string | null {
  if (!body) return null;
  const parts: string[] = [];
  if (body.error?.message) parts.push(body.error.message + (body.error.details ? `: ${body.error.details}` : ''));
  for (const [nodeId, ne] of Object.entries<any>(body.node_errors ?? {})) {
    for (const e of ne.errors ?? []) parts.push(`Node ${nodeId} (${ne.class_type}): ${e.message}${e.details ? ` — ${e.details}` : ''}`);
  }
  return parts.length ? parts.join(' | ') : null;
}

// ── Mock backend (offline test mode) ────────────────────────────────────────

interface MockJob {
  at: number;
  graph: ComfyGraph;
  images?: { name: string; bytes: Buffer }[];
}

const g = globalThis as unknown as { __siennaMockJobs?: Map<string, MockJob>; __siennaMockFiles?: Map<string, Buffer> };
const mockJobs: Map<string, MockJob> = (g.__siennaMockJobs ??= new Map());
const mockFiles: Map<string, Buffer> = (g.__siennaMockFiles ??= new Map());

const MOCK_CHOICES: Record<string, string[]> = {
  ckpt_name: ['sd_xl_base_1.0.safetensors', 'realvisxlV50_v50Bakedvae.safetensors', 'juggernautXL_v9.safetensors'],
  unet_name: ['flux1-dev.safetensors', 'flux1-dev-fp8.safetensors'],
  lora_name: ['sienna_v1.safetensors', 'sienna_flux_v1.safetensors', 'detail_tweaker_xl.safetensors'],
  sampler_name: ['euler', 'euler_ancestral', 'ddpm', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'uni_pc'],
  scheduler: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'beta'],
  control_net_name: ['OpenPoseXL2.safetensors', 'controlnet-union-sdxl-promax.safetensors'],
  model_name: ['bbox/face_yolov8m.pt'],
};

export class MockComfy implements ComfyBackend {
  readonly kind = 'mock' as const;
  async systemInfo(): Promise<SystemInfo> {
    return { ok: true, backend: 'mock', comfyuiVersion: 'mock', devices: [{ name: 'Mock GPU (no real generation)', type: 'mock' }] };
  }
  async inputChoices(_cls: string, inputName: string) {
    return MOCK_CHOICES[inputName] ?? [];
  }
  /** Mock mode pretends every node class is installed. */
  async nodeInfo(_cls: string): Promise<NodeInfo | null> {
    return { input: { required: {} }, python_module: 'mock' };
  }
  async uploadImage(bytes: Buffer, filename: string) {
    mockFiles.set(filename, bytes);
    return `sienna/${filename}`;
  }
  async queuePrompt(graph: ComfyGraph) {
    const id = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    mockJobs.set(id, { at: Date.now(), graph });
    return { promptId: id };
  }
  async jobState(promptId: string): Promise<JobState> {
    const job = mockJobs.get(promptId);
    if (!job) return { state: 'unknown' };
    const elapsed = Date.now() - job.at;
    if (elapsed < 1200) return { state: 'pending', position: 1 };
    if (elapsed < 3500) return { state: 'running' };
    if (!job.images) {
      const latent = Object.values(job.graph).find((n) => /Latent|ImageScale/.test(n.class_type) && typeof n.inputs.width === 'number');
      const sampler = Object.values(job.graph).find((n) => typeof n.inputs.seed === 'number' || typeof n.inputs.noise_seed === 'number');
      const w = Number(latent?.inputs.width ?? 832);
      const h = Number(latent?.inputs.height ?? 1216);
      const seed = Number(sampler?.inputs.seed ?? sampler?.inputs.noise_seed ?? 1);
      const batch = Math.min(4, Math.max(1, Number(latent?.inputs.batch_size ?? 1)));
      job.images = [];
      for (let i = 0; i < batch; i++) {
        const img = mockPortrait(w, h, seed + i);
        job.images.push({ name: `mock_${promptId}_${i}.png`, bytes: encodePng(img.width, img.height, img.rgb) });
      }
    }
    return { state: 'done', images: job.images.map((im) => ({ filename: im.name, subfolder: '', type: 'output', nodeId: 'mock' })) };
  }
  async fetchImage(ref: OutputImageRef) {
    for (const job of mockJobs.values()) {
      const img = job.images?.find((i) => i.name === ref.filename);
      if (img) return { bytes: img.bytes, mime: 'image/png' };
    }
    throw new ComfyError('Mock image not found (server restarted?).', 404);
  }
  async interrupt() {}
}

export function isMockUrl(url: string) {
  return !url || url.trim().toLowerCase() === 'mock';
}

export function createBackend(url: string): ComfyBackend {
  return isMockUrl(url) ? new MockComfy() : new RealComfy(url.trim());
}
