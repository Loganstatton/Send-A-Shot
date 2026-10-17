/**
 * On-demand photo GPU (PHOTO_GPU=runpod): a RunPod pod on the production network volume (Sienna's models, LoRA,
 * packs and ComfyUI live there), started when a photo needs it and stopped after PHOTO_GPU_IDLE_MIN minutes with
 * nothing to do. While it runs, getComfyUrl() points at it, so every photo tool uses it unchanged.
 *
 * Lifecycle (one session at a time, persisted in DATA_DIR/photo-gpu.json):
 *   starting → a pod is requested (preferred GPU type first, then any of the others); ComfyUI on the volume boots
 *   ready    → ComfyUI answers; photos waiting for the GPU are submitted
 *   stopped  → terminated (idle, by hand, timed out, over budget); the cost goes to the ledger
 * A pod that never comes up (RunPod sometimes hands out a machine that can't start the container) is replaced once
 * by a pod on another machine; a second failure is reported. The volume is attached unchanged — never modified.
 *
 * Cost safety: the pod's own lifetime timer and idle auto-stop (they work even if this app is down), plus this app's
 * idle shutdown, startup timeout, maximum session length and monthly budget.
 */

import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store';
import { GpuError, runpod, type LedgerEntry } from './video-gpu';

export const PHOTO_POD_PREFIX = 'sienna-photo';
export const PHOTO_GPU_STATE_FILE = 'photo-gpu.json';

export interface PhotoGpuConfig {
  apiKey: string;
  apiBase: string;
  volumeId: string;
  dataCenter: string;
  templateId?: string;
  image: string;
  /** The first is tried on its own; if it has no capacity the rest are requested together (any of them). */
  gpuTypes: string[];
  cloudType: 'SECURE' | 'COMMUNITY';
  diskGb: number;
  urlTemplate: string;
  startupTimeoutMin: number;
  idleMin: number;
  maxSessionMin: number;
  monthlyBudgetUsd: number;
  estRate: number;
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export function photoGpuEnabled(): boolean {
  return process.env.PHOTO_GPU === 'runpod';
}

/** What is missing to use the on-demand photo GPU (empty = configured). */
export function photoGpuMissing(): string[] {
  if (!photoGpuEnabled()) return [];
  const e = process.env;
  const m: string[] = [];
  if (!(e.PHOTO_RUNPOD_API_KEY || e.VIDEO_RUNPOD_API_KEY)?.trim()) m.push('PHOTO_RUNPOD_API_KEY (or VIDEO_RUNPOD_API_KEY)');
  if (!e.PHOTO_GPU_VOLUME_ID?.trim()) m.push('PHOTO_GPU_VOLUME_ID (the network volume with the photo models)');
  if (!e.PHOTO_GPU_DATACENTER?.trim()) m.push('PHOTO_GPU_DATACENTER (the volume’s data centre, e.g. US-IL-1)');
  return m;
}

export function photoGpuConfig(): PhotoGpuConfig | null {
  if (!photoGpuEnabled() || photoGpuMissing().length) return null;
  const e = process.env;
  return {
    apiKey: (e.PHOTO_RUNPOD_API_KEY || e.VIDEO_RUNPOD_API_KEY)!.trim(),
    apiBase: (e.PHOTO_GPU_API_BASE || e.VIDEO_GPU_API_BASE || 'https://rest.runpod.io/v1').replace(/\/+$/, ''),
    volumeId: e.PHOTO_GPU_VOLUME_ID!.trim(),
    dataCenter: e.PHOTO_GPU_DATACENTER!.trim(),
    templateId: e.PHOTO_GPU_TEMPLATE_ID?.trim() || undefined,
    image: e.PHOTO_GPU_IMAGE || 'runpod/comfyui:1.3.3-comfyuiv0.30.0-cuda12.8',
    gpuTypes: (
      e.PHOTO_GPU_TYPES ||
      'NVIDIA GeForce RTX 4090,NVIDIA GeForce RTX 5090,NVIDIA RTX 6000 Ada Generation,NVIDIA L40S,NVIDIA L40,NVIDIA RTX A6000,NVIDIA A40'
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cloudType: e.PHOTO_GPU_CLOUD === 'COMMUNITY' ? 'COMMUNITY' : 'SECURE',
    diskGb: num(e.PHOTO_GPU_DISK_GB, 40),
    urlTemplate: e.PHOTO_GPU_URL_TEMPLATE || 'https://{id}-8188.proxy.runpod.net',
    startupTimeoutMin: num(e.PHOTO_GPU_STARTUP_TIMEOUT_MIN, 7),
    idleMin: num(e.PHOTO_GPU_IDLE_MIN, 10),
    maxSessionMin: num(e.PHOTO_GPU_MAX_SESSION_MIN, 240),
    monthlyBudgetUsd: num(e.PHOTO_GPU_MONTHLY_BUDGET_USD, 15),
    estRate: num(e.PHOTO_GPU_EST_RATE, 0.89),
  };
}

// ── State ──────────────────────────────────────────────────────────────────────

export type PhotoSessionStatus = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface PhotoGpuSession {
  podId: string;
  name: string;
  gpu: string;
  rate: number;
  url: string;
  status: PhotoSessionStatus;
  createdAt: string;
  /** When the current pod was requested (a replacement pod restarts the startup clock). */
  podCreatedAt: string;
  readyAt?: string;
  endedAt?: string;
  lastActivityAt: string;
  phase?: string;
  error?: string;
  stopReason?: string;
  /** Pods requested in this session (a stuck start is replaced once). */
  pods: number;
  /** Cost of pods already replaced in this session. */
  priorUsd: number;
  attempts: string[];
}

interface State {
  session: PhotoGpuSession | null;
  ledger: LedgerEntry[];
}

const STATE_FILE = path.join(DATA_DIR, PHOTO_GPU_STATE_FILE);
const gl = globalThis as unknown as { __siennaPhotoGpu?: { lock: Promise<unknown>; timer?: NodeJS.Timeout } };
const mem = (gl.__siennaPhotoGpu ??= { lock: Promise.resolve() });

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mem.lock.then(fn, fn);
  mem.lock = run.catch(() => {});
  return run;
}

async function load(): Promise<State> {
  try {
    const s = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    return { session: s.session ?? null, ledger: Array.isArray(s.ledger) ? s.ledger : [] };
  } catch {
    return { session: null, ledger: [] };
  }
}

async function save(s: State) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 2));
  await fs.rename(tmp, STATE_FILE);
}

const hours = (from: string, to?: string) => Math.max(0, ((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 3_600_000);
const podCost = (s: PhotoGpuSession) => (s.podId ? s.rate * hours(s.podCreatedAt, s.endedAt) : 0);
export const photoSessionCost = (s: PhotoGpuSession) => Math.round((s.priorUsd + podCost(s)) * 1000) / 1000;
const active = (s: PhotoGpuSession | null): s is PhotoGpuSession => !!s && (s.status === 'starting' || s.status === 'ready' || s.status === 'stopping');

function monthSpend(st: State, now = new Date()): number {
  const ym = now.toISOString().slice(0, 7);
  const done = st.ledger.filter((l) => l.endedAt.slice(0, 7) === ym).reduce((a, l) => a + l.usd, 0);
  return Math.round((done + (active(st.session) ? photoSessionCost(st.session) : 0)) * 1000) / 1000;
}

/** The ComfyUI address of the running (or starting) photo GPU, or null. Read by store.getComfyUrl(). */
export async function photoGpuUrl(): Promise<string | null> {
  const s = (await load()).session;
  return active(s) && s.url ? s.url : null;
}

export async function photoGpuReady(): Promise<boolean> {
  const s = (await load()).session;
  return !!s && s.status === 'ready';
}

// ── RunPod ─────────────────────────────────────────────────────────────────────

interface PodInfo {
  id: string;
  name?: string;
  desiredStatus?: string;
  costPerHr?: number | string;
  machine?: { gpuTypeId?: string } | null;
}

async function listPhotoPods(c: PhotoGpuConfig): Promise<PodInfo[]> {
  const pods = await runpod<PodInfo[] | { pods?: PodInfo[] }>(c, 'GET', '/pods');
  const list = Array.isArray(pods) ? pods : pods.pods ?? [];
  return list.filter((p) => (p.name ?? '').startsWith(PHOTO_POD_PREFIX) && p.desiredStatus === 'RUNNING');
}

async function terminatePod(c: PhotoGpuConfig, id: string) {
  try {
    await runpod(c, 'DELETE', `/pods/${encodeURIComponent(id)}`);
  } catch (e: any) {
    if (e instanceof GpuError && /→ 404/.test(e.message)) return;
    throw e;
  }
}

/** Lifetime limit inside the pod (works even if this app is down), then the image's own start. */
export function photoPodStartCommand(c: PhotoGpuConfig): string {
  return [`(sleep ${Math.round(c.maxSessionMin * 60)}; runpodctl remove pod "$RUNPOD_POD_ID") >/dev/null 2>&1 &`, 'exec /start.sh'].join('\n');
}

/** Request a pod: the preferred GPU type alone, then any of the others. Returns the pod or throws with the reasons. */
async function createPod(c: PhotoGpuConfig, name: string, attempts: string[], skipGpu?: string): Promise<{ pod: PodInfo; gpu: string }> {
  const types = c.gpuTypes.filter((g) => g !== skipGpu);
  const tiers = [types.slice(0, 1), types.slice(1)].filter((t) => t.length);
  for (const tier of tiers) {
    try {
      const pod = await runpod<PodInfo>(c, 'POST', '/pods', {
        name,
        ...(c.templateId ? { templateId: c.templateId } : {}),
        imageName: c.image,
        gpuTypeIds: tier,
        gpuCount: 1,
        cloudType: c.cloudType,
        containerDiskInGb: c.diskGb,
        networkVolumeId: c.volumeId,
        dataCenterIds: [c.dataCenter],
        // only ComfyUI is exposed: no Jupyter, no SSH
        ports: ['8188/http'],
        env: { SIENNA_IDLE_MINUTES: String(c.idleMin + 5) },
        dockerEntrypoint: ['bash', '-c'],
        dockerStartCmd: [photoPodStartCommand(c)],
      });
      if (!pod?.id) throw new GpuError('RunPod returned no pod id');
      return { pod, gpu: pod.machine?.gpuTypeId || (tier.length === 1 ? tier[0] : 'one of ' + tier.length + ' GPU types') };
    } catch (e: any) {
      attempts.push(`${tier.length === 1 ? tier[0] : 'other GPU types'}: ${e.message}`);
      if (e instanceof GpuError && e.status === 502) break; // bad API key
    }
  }
  throw new GpuError(`No photo GPU is free right now in ${c.dataCenter} (where Sienna's models are) — try again in a few minutes. ${attempts.slice(-2).join('; ')}`);
}

// ── Session control ────────────────────────────────────────────────────────────

export interface PhotoGpuView {
  mode: 'on-demand' | 'settings-url';
  status: PhotoSessionStatus | 'off';
  gpu?: string;
  rate?: number;
  since?: string;
  readyAt?: string;
  phase?: string;
  error?: string;
  sessionUsd?: number;
  monthUsd: number;
  budgetUsd: number;
  idleMin?: number;
  missing?: string[];
}

export async function photoGpuView(): Promise<PhotoGpuView> {
  const c = photoGpuConfig();
  const missing = photoGpuMissing();
  if (!c) return { mode: 'settings-url', status: 'off', monthUsd: 0, budgetUsd: 0, ...(missing.length ? { missing } : {}) };
  const st = await load();
  const s = st.session;
  return {
    mode: 'on-demand',
    status: s ? s.status : 'off',
    ...(s ? { gpu: s.gpu, rate: s.rate, since: s.createdAt, readyAt: s.readyAt, phase: s.phase, error: s.error, sessionUsd: photoSessionCost(s) } : {}),
    monthUsd: monthSpend(st),
    budgetUsd: c.monthlyBudgetUsd,
    idleMin: c.idleMin,
  };
}

/** Make sure a photo GPU exists (starting or ready). Never creates a second one. */
export function ensurePhotoGpu(): Promise<PhotoGpuSession> {
  return withLock(async () => {
    const c = photoGpuConfig();
    if (!c) throw new GpuError('The on-demand photo GPU is not configured.', 500);
    const st = await load();
    if (active(st.session) && st.session.status !== 'stopping') return st.session;
    if (monthSpend(st) + c.estRate * (c.idleMin + 5) / 60 > c.monthlyBudgetUsd)
      throw new GpuError(
        `This month’s photo GPU budget is used up ($${monthSpend(st).toFixed(2)} of $${c.monthlyBudgetUsd.toFixed(2)}). Raise PHOTO_GPU_MONTHLY_BUDGET_USD to continue.`,
        402,
      );
    const now = new Date().toISOString();
    const existing = await listPhotoPods(c);
    if (existing.length) {
      // left over from before an app restart: reuse one, stop the rest
      const [keep, ...extra] = existing;
      for (const p of extra) await terminatePod(c, p.id).catch(() => {});
      st.session = {
        podId: keep.id, name: keep.name ?? PHOTO_POD_PREFIX, gpu: keep.machine?.gpuTypeId ?? 'unknown', rate: Number(keep.costPerHr) || c.estRate,
        url: c.urlTemplate.replace('{id}', keep.id), status: 'starting', createdAt: now, podCreatedAt: now, lastActivityAt: now,
        phase: 'reconnecting to the photo GPU', pods: 1, priorUsd: 0, attempts: ['reused a photo pod that was already running'],
      };
      await save(st);
      return st.session;
    }
    const name = `${PHOTO_POD_PREFIX}-${Date.now().toString(36)}`;
    const attempts: string[] = [];
    try {
      const { pod, gpu } = await createPod(c, name, attempts);
      const t = new Date().toISOString();
      st.session = {
        podId: pod.id, name, gpu, rate: Number(pod.costPerHr) || c.estRate, url: c.urlTemplate.replace('{id}', pod.id), status: 'starting',
        createdAt: t, podCreatedAt: t, lastActivityAt: t, phase: 'booting the GPU', pods: 1, priorUsd: 0, attempts,
      };
      await save(st);
      return st.session;
    } catch (e: any) {
      st.session = {
        podId: '', name, gpu: '', rate: c.estRate, url: '', status: 'failed', createdAt: now, podCreatedAt: now, lastActivityAt: now,
        endedAt: new Date().toISOString(), error: e.message, pods: 0, priorUsd: 0, attempts,
      };
      await save(st);
      throw e instanceof GpuError ? e : new GpuError(e.message);
    }
  });
}

/** A photo job was submitted or finished: restart the idle timer. */
export function touchPhotoGpu() {
  return withLock(async () => {
    const st = await load();
    if (!active(st.session)) return;
    st.session = { ...st.session, lastActivityAt: new Date().toISOString() };
    await save(st);
  });
}

export function stopPhotoGpu(reason: string): Promise<PhotoGpuSession | null> {
  return withLock(() => stopLocked(reason));
}

async function stopLocked(reason: string, failed = false): Promise<PhotoGpuSession | null> {
  const c = photoGpuConfig();
  const st = await load();
  const s = st.session;
  if (!c || !s || !active(s)) return s;
  try {
    if (s.podId) await terminatePod(c, s.podId);
  } catch (e: any) {
    st.session = { ...s, status: 'stopping', stopReason: reason, error: `Stopping the photo GPU failed: ${e.message}` };
    await save(st);
    return st.session;
  }
  const ended = new Date().toISOString();
  const done: PhotoGpuSession = { ...s, status: failed ? 'failed' : 'stopped', endedAt: ended, stopReason: reason, ...(failed ? { error: reason } : {}) };
  st.session = done;
  if (s.podId || s.priorUsd) st.ledger.push({ podId: s.podId, gpu: s.gpu, rate: s.rate, startedAt: s.createdAt, endedAt: ended, usd: photoSessionCost(done), reason });
  await save(st);
  return done;
}

export type PhotoProbe = (url: string) => Promise<boolean>;

/**
 * Housekeeping (every 30 s and on status polls). `busy` = photo jobs that still need the GPU (waiting, queued or
 * running). Returns the session after the check.
 */
export function tickPhotoGpu(busy: number, probe: PhotoProbe): Promise<PhotoGpuSession | null> {
  return withLock(async () => {
    const c = photoGpuConfig();
    if (!c) return null;
    const st = await load();
    const s = st.session;
    if (!s || !active(s)) return s;
    const now = Date.now();
    if (s.status === 'stopping') return stopLocked(s.stopReason ?? 'stopping');
    if (monthSpend(st) > c.monthlyBudgetUsd) return stopLocked(`stopped: this month’s photo GPU budget of $${c.monthlyBudgetUsd.toFixed(2)} was reached`, true);
    if ((now - Date.parse(s.createdAt)) / 60_000 > c.maxSessionMin) return stopLocked(`stopped: the photo GPU ran for its maximum of ${c.maxSessionMin} min`, busy > 0);
    if (s.status === 'starting') {
      const podAge = (now - Date.parse(s.podCreatedAt)) / 60_000;
      if (busy === 0 && podAge > 3 && !s.readyAt) return stopLocked('no photo needs the GPU any more');
      if (await probe(s.url).catch(() => false)) {
        st.session = { ...s, status: 'ready', readyAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), phase: 'ready' };
        await save(st);
        return st.session;
      }
      if (podAge > c.startupTimeoutMin) {
        // RunPod sometimes hands out a machine that never starts the container: replace it once, on another machine
        const priorUsd = s.priorUsd + podCost({ ...s, endedAt: new Date().toISOString() });
        await terminatePod(c, s.podId).catch(() => {});
        if (s.pods >= 2) {
          st.session = { ...s, priorUsd, podId: '', status: 'failed', endedAt: new Date().toISOString(), error: `The photo GPU didn’t start on two machines in a row (RunPod ${c.dataCenter}). Try again in a few minutes.` };
          st.ledger.push({ podId: s.podId, gpu: s.gpu, rate: s.rate, startedAt: s.createdAt, endedAt: st.session.endedAt!, usd: Math.round(priorUsd * 1000) / 1000, reason: 'startup failed twice' });
          await save(st);
          return st.session;
        }
        try {
          const attempts = [...s.attempts, `${s.gpu} machine never started ComfyUI within ${c.startupTimeoutMin} min — replaced`];
          const { pod, gpu } = await createPod(c, s.name, attempts);
          st.session = {
            ...s, podId: pod.id, gpu, rate: Number(pod.costPerHr) || c.estRate, url: c.urlTemplate.replace('{id}', pod.id), podCreatedAt: new Date().toISOString(),
            phase: 'the first machine didn’t start — trying another one', pods: s.pods + 1, priorUsd, attempts,
          };
        } catch (e: any) {
          st.session = { ...s, priorUsd, podId: '', status: 'failed', endedAt: new Date().toISOString(), error: e.message };
          st.ledger.push({ podId: s.podId, gpu: s.gpu, rate: s.rate, startedAt: s.createdAt, endedAt: st.session.endedAt!, usd: Math.round(priorUsd * 1000) / 1000, reason: 'startup failed' });
        }
        await save(st);
        return st.session;
      }
      try {
        const pod = await runpod<PodInfo>(c, 'GET', `/pods/${encodeURIComponent(s.podId)}`);
        if (pod?.desiredStatus === 'EXITED' || pod?.desiredStatus === 'TERMINATED') return stopLocked(`the photo GPU stopped while starting (RunPod status ${pod.desiredStatus})`, true);
        const rate = Number(pod?.costPerHr) || s.rate;
        const gpu = pod?.machine?.gpuTypeId || s.gpu;
        if (rate !== s.rate || gpu !== s.gpu) {
          st.session = { ...s, rate, gpu };
          await save(st);
          return st.session;
        }
      } catch {
        /* RunPod blip: next tick */
      }
      return s;
    }
    // ready
    if (busy === 0 && (now - Date.parse(s.lastActivityAt)) / 60_000 >= c.idleMin) return stopLocked(`stopped after ${c.idleMin} min without photos`);
    try {
      const pod = await runpod<PodInfo>(c, 'GET', `/pods/${encodeURIComponent(s.podId)}`);
      if (pod?.desiredStatus === 'EXITED' || pod?.desiredStatus === 'TERMINATED') return stopLocked(`the photo GPU was stopped outside the app (RunPod status ${pod.desiredStatus})`, busy > 0);
    } catch (e: any) {
      if (e instanceof GpuError && /→ 404/.test(e.message)) return stopLocked('the photo GPU no longer exists on RunPod', busy > 0);
    }
    return s;
  });
}

export function startPhotoGpuTimer(fn: () => Promise<unknown>) {
  if (mem.timer || !photoGpuConfig()) return;
  mem.timer = setInterval(() => {
    fn().catch((e) => console.error('[photo-gpu] housekeeping failed:', e?.message ?? e));
  }, 30_000);
  mem.timer.unref?.();
}
