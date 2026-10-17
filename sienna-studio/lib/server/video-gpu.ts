/**
 * On-demand video GPU (VIDEO_GPU=runpod): a temporary RunPod pod with no network volume, started when a video needs
 * it and terminated when no video needs it any more. It is completely separate from the photo GPU (Settings → ComfyUI
 * URL) and never touches the production volume.
 *
 * Lifecycle (one session at a time, persisted in DATA_DIR/video-gpu.json):
 *   starting → the pod boots the official ComfyUI image; its start command fetches this app's setup kit
 *              (/api/video-gpu/kit/<token>/setup.sh), which downloads the Animate Image models, installs sienna_nodes
 *              (Lock Camera, face check, segmenter) and the idle auto-stop, and restarts ComfyUI
 *   ready    → ComfyUI answers and has the video nodes and model files; queued videos are submitted
 *   stopped  → terminated (idle, finished, failed, timed out, over budget, or by hand); the cost goes to the ledger
 *
 * Cost safety, from the inside out:
 *   - the pod itself: a max-lifetime timer in its start command (VIDEO_GPU_MAX_SESSION_MIN) and the sienna_autostop
 *     node (terminates after SIENNA_IDLE_MINUTES without ComfyUI work) — both work even if this app is down
 *   - this app: startup timeout, job timeout (video.ts), idle shutdown, max session length, monthly budget
 *   - one pod at most: an in-process lock + the persisted session + a check of RunPod for existing video pods
 * Nothing expensive is retried automatically: a failed start or job is reported and the pod is stopped.
 */

import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './store';

export const VIDEO_POD_PREFIX = 'sienna-video';

export interface VideoGpuConfig {
  apiKey: string;
  apiBase: string;
  /** This app's public URL; the pod downloads its setup kit from it. */
  publicUrl: string;
  /** Tried in order, once each (a GPU type with no capacity costs nothing). */
  gpuTypes: string[];
  image: string;
  cloudType: 'SECURE' | 'COMMUNITY';
  diskGb: number;
  minRamGb: number;
  /** ComfyUI address of a pod; {id} is replaced by the pod id. */
  urlTemplate: string;
  startupTimeoutMin: number;
  jobTimeoutMin: number;
  idleMin: number;
  maxSessionMin: number;
  monthlyBudgetUsd: number;
  /** Assumed $/h before RunPod reports the real rate (used for budget checks). */
  estRate: number;
  /** Also install Copy Motion (Wan Animate 2, +24 GB, longer start). */
  copyMotion: boolean;
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** What is missing to use the on-demand video GPU (empty = configured). */
export function videoGpuMissing(): string[] {
  if (process.env.VIDEO_GPU !== 'runpod') return [];
  const m: string[] = [];
  // its own key, never RUNPOD_API_KEY: that name may already hold another credential on the server
  if (!process.env.VIDEO_RUNPOD_API_KEY?.trim()) m.push('VIDEO_RUNPOD_API_KEY');
  if (!process.env.PUBLIC_URL?.trim()) m.push('PUBLIC_URL (this site’s address, e.g. https://sienna-studio.onrender.com)');
  return m;
}

/** null = videos use the ComfyUI URL from Settings (the previous behaviour). */
export function videoGpuConfig(): VideoGpuConfig | null {
  if (process.env.VIDEO_GPU !== 'runpod' || videoGpuMissing().length) return null;
  const e = process.env;
  return {
    apiKey: e.VIDEO_RUNPOD_API_KEY!.trim(),
    apiBase: (e.VIDEO_GPU_API_BASE || 'https://rest.runpod.io/v1').replace(/\/+$/, ''),
    publicUrl: e.PUBLIC_URL!.trim().replace(/\/+$/, ''),
    gpuTypes: (e.VIDEO_GPU_TYPES || 'NVIDIA A40,NVIDIA GeForce RTX 4090').split(',').map((s) => s.trim()).filter(Boolean),
    image: e.VIDEO_GPU_IMAGE || 'runpod/comfyui:1.4.0-comfyuiv0.35.0-cuda12.8',
    cloudType: e.VIDEO_GPU_CLOUD === 'COMMUNITY' ? 'COMMUNITY' : 'SECURE',
    diskGb: num(e.VIDEO_GPU_DISK_GB, 120),
    minRamGb: num(e.VIDEO_GPU_MIN_RAM_GB, 48),
    urlTemplate: e.VIDEO_GPU_URL_TEMPLATE || 'https://{id}-8188.proxy.runpod.net',
    startupTimeoutMin: num(e.VIDEO_GPU_STARTUP_TIMEOUT_MIN, 25),
    jobTimeoutMin: num(e.VIDEO_GPU_JOB_TIMEOUT_MIN, 15),
    idleMin: num(e.VIDEO_GPU_IDLE_MIN, 5),
    maxSessionMin: num(e.VIDEO_GPU_MAX_SESSION_MIN, 90),
    monthlyBudgetUsd: num(e.VIDEO_GPU_MONTHLY_BUDGET_USD, 5),
    estRate: num(e.VIDEO_GPU_EST_RATE, 0.69),
    copyMotion: e.VIDEO_GPU_COPY_MOTION === 'true',
  };
}

// ── State ──────────────────────────────────────────────────────────────────────

export type SessionStatus = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface VideoGpuSession {
  podId: string;
  name: string;
  gpu: string;
  /** $/h as RunPod reported it. */
  rate: number;
  url: string;
  kitToken: string;
  status: SessionStatus;
  createdAt: string;
  readyAt?: string;
  endedAt?: string;
  lastActivityAt: string;
  /** Last setup step seen (for the waiting screen). */
  phase?: string;
  error?: string;
  stopReason?: string;
  /** The record whose job pays for the start-up minutes in its cost line. */
  startupBilledTo?: string;
  /** GPU types tried and why they were skipped. */
  attempts: string[];
}

export interface LedgerEntry {
  podId: string;
  gpu: string;
  rate: number;
  startedAt: string;
  endedAt: string;
  usd: number;
  reason: string;
}

interface State {
  session: VideoGpuSession | null;
  ledger: LedgerEntry[];
}

const STATE_FILE = path.join(DATA_DIR, 'video-gpu.json');
const gl = globalThis as unknown as { __siennaVideoGpu?: { lock: Promise<unknown>; timer?: NodeJS.Timeout } };
const mem = (gl.__siennaVideoGpu ??= { lock: Promise.resolve() });

/** Serialise everything that reads-then-writes the session (one pod at most, even with concurrent requests). */
function withGpuLock<T>(fn: () => Promise<T>): Promise<T> {
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
export const sessionCost = (s: VideoGpuSession) => Math.round(s.rate * hours(s.createdAt, s.endedAt) * 1000) / 1000;
const active = (s: VideoGpuSession | null): s is VideoGpuSession => !!s && (s.status === 'starting' || s.status === 'ready' || s.status === 'stopping');

/** Spend this calendar month (UTC): finished sessions + the running one. */
export function monthSpend(st: State, now = new Date()): number {
  const ym = now.toISOString().slice(0, 7);
  const done = st.ledger.filter((l) => l.endedAt.slice(0, 7) === ym).reduce((a, l) => a + l.usd, 0);
  return Math.round((done + (active(st.session) ? sessionCost(st.session) : 0)) * 1000) / 1000;
}

// ── RunPod REST ────────────────────────────────────────────────────────────────

export class GpuError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
  }
}

async function runpod<T = any>(c: VideoGpuConfig, method: string, p: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(c.apiBase + p, {
      method,
      headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
      cache: 'no-store',
    });
  } catch (e: any) {
    throw new GpuError(`RunPod could not be reached (${e?.cause?.code ?? e.message})`);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      msg = j.error || j.message || msg;
    } catch {}
    throw new GpuError(`RunPod ${method} ${p} → ${res.status}: ${msg}`, res.status === 401 || res.status === 403 ? 502 : 503);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

interface PodInfo {
  id: string;
  name?: string;
  desiredStatus?: string;
  costPerHr?: number | string;
}

async function listVideoPods(c: VideoGpuConfig): Promise<PodInfo[]> {
  const pods = await runpod<PodInfo[] | { pods?: PodInfo[] }>(c, 'GET', '/pods');
  const list = Array.isArray(pods) ? pods : pods.pods ?? [];
  return list.filter((p) => (p.name ?? '').startsWith(VIDEO_POD_PREFIX) && p.desiredStatus !== 'TERMINATED' && p.desiredStatus !== 'EXITED');
}

async function terminatePod(c: VideoGpuConfig, id: string) {
  try {
    await runpod(c, 'DELETE', `/pods/${encodeURIComponent(id)}`);
  } catch (e: any) {
    if (e instanceof GpuError && /→ 404/.test(e.message)) return; // already gone
    throw e;
  }
}

/**
 * The pod's start script: a hard lifetime limit, the setup kit in the background, then the image's own start.
 * The image's ENTRYPOINT is /start.sh, which ignores a start command passed as its arguments, so the pod is created
 * with the entrypoint replaced by `bash -c` and this script as its only argument.
 */
export function podStartCommand(c: VideoGpuConfig, kitUrl: string): string {
  const maxSec = Math.round(c.maxSessionMin * 60);
  const script = [
    `(sleep ${maxSec}; runpodctl remove pod "$RUNPOD_POD_ID") >/dev/null 2>&1 &`,
    `(curl -fsSL --retry 5 '${kitUrl}/setup.sh' -o /tmp/sienna-setup.sh && SIENNA_KIT='${kitUrl}' bash /tmp/sienna-setup.sh) > /tmp/sienna-setup.log 2>&1 &`,
    'exec /start.sh',
  ].join('\n');
  return script;
}

// ── Session control ────────────────────────────────────────────────────────────

export interface GpuView {
  mode: 'on-demand' | 'settings-url';
  status: SessionStatus | 'off';
  podId?: string;
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
  startupTimeoutMin?: number;
  missing?: string[];
}

export async function videoGpuView(): Promise<GpuView> {
  const c = videoGpuConfig();
  const missing = videoGpuMissing();
  if (!c) return { mode: 'settings-url', status: 'off', monthUsd: 0, budgetUsd: 0, ...(missing.length ? { missing } : {}) };
  const st = await load();
  const s = st.session;
  return {
    mode: 'on-demand',
    status: s ? s.status : 'off',
    ...(s
      ? { podId: s.podId, gpu: s.gpu, rate: s.rate, since: s.createdAt, readyAt: s.readyAt, phase: s.phase, error: s.error, sessionUsd: sessionCost(s) }
      : {}),
    monthUsd: monthSpend(st),
    budgetUsd: c.monthlyBudgetUsd,
    idleMin: c.idleMin,
    startupTimeoutMin: c.startupTimeoutMin,
  };
}

export async function currentSession(): Promise<VideoGpuSession | null> {
  return (await load()).session;
}

/** Rough cost of one more video including a GPU start (for the budget check before queuing). */
export function estimateVideoUsd(c: VideoGpuConfig, needsStart: boolean, jobMinutes: number) {
  return Math.round(c.estRate * ((needsStart ? 12 : 0) + jobMinutes + (needsStart ? c.idleMin : 0)) * 1000 / 60) / 1000;
}

/**
 * Make sure a video GPU exists (starting or ready). Never creates a second pod: the session file, the lock and
 * RunPod's own pod list are all checked. Throws GpuError with a readable message when it can't start one.
 */
export function ensureVideoGpu(): Promise<VideoGpuSession> {
  return withGpuLock(async () => {
    const c = videoGpuConfig();
    if (!c) throw new GpuError('The on-demand video GPU is not configured.', 500);
    const st = await load();
    if (active(st.session) && st.session.status !== 'stopping') return st.session;
    if (monthSpend(st) + estimateVideoUsd(c, true, 3) > c.monthlyBudgetUsd)
      throw new GpuError(
        `This month’s video GPU budget is used up ($${monthSpend(st).toFixed(2)} of $${c.monthlyBudgetUsd.toFixed(2)}). Raise VIDEO_GPU_MONTHLY_BUDGET_USD to continue.`,
        402,
      );
    // a pod left over from an earlier session (e.g. the app restarted while one ran): adopt one, stop the rest
    const existing = await listVideoPods(c);
    const now = new Date().toISOString();
    if (existing.length) {
      const [keep, ...extra] = existing;
      for (const p of extra) await terminatePod(c, p.id).catch(() => {});
      const s: VideoGpuSession = {
        podId: keep.id,
        name: keep.name ?? VIDEO_POD_PREFIX,
        gpu: 'unknown',
        rate: Number(keep.costPerHr) || c.estRate,
        url: c.urlTemplate.replace('{id}', keep.id),
        kitToken: st.session?.kitToken ?? crypto.randomBytes(18).toString('hex'),
        status: 'starting',
        createdAt: now,
        lastActivityAt: now,
        phase: 'reconnecting to a video GPU that was already running',
        attempts: ['adopted an existing video pod'],
      };
      st.session = s;
      await save(st);
      return s;
    }
    const kitToken = crypto.randomBytes(18).toString('hex');
    const kitUrl = `${c.publicUrl}/api/video-gpu/kit/${kitToken}`;
    const attempts: string[] = [];
    const name = `${VIDEO_POD_PREFIX}-${Date.now().toString(36)}`;
    // the kit must be fetchable before the pod asks for it
    st.session = {
      podId: '',
      name,
      gpu: '',
      rate: c.estRate,
      url: '',
      kitToken,
      status: 'starting',
      createdAt: now,
      lastActivityAt: now,
      phase: 'requesting a GPU',
      attempts,
    };
    await save(st);
    for (const gpu of c.gpuTypes) {
      try {
        const pod = await runpod<PodInfo>(c, 'POST', '/pods', {
          name,
          imageName: c.image,
          gpuTypeIds: [gpu],
          gpuCount: 1,
          cloudType: c.cloudType,
          containerDiskInGb: c.diskGb,
          volumeInGb: 0,
          minRAMPerGPU: c.minRamGb,
          // only ComfyUI is exposed: no Jupyter, no SSH
          ports: ['8188/http'],
          env: { SIENNA_IDLE_MINUTES: String(c.idleMin + 3), SIENNA_COPY_MOTION: c.copyMotion ? '1' : '0' },
          dockerEntrypoint: ['bash', '-c'],
          dockerStartCmd: [podStartCommand(c, kitUrl)],
        });
        if (!pod?.id) throw new GpuError('RunPod returned no pod id');
        const s: VideoGpuSession = {
          ...st.session,
          podId: pod.id,
          gpu,
          rate: Number(pod.costPerHr) || c.estRate,
          url: c.urlTemplate.replace('{id}', pod.id),
          phase: 'booting the GPU',
          attempts,
          createdAt: new Date().toISOString(),
        };
        st.session = s;
        await save(st);
        return s;
      } catch (e: any) {
        attempts.push(`${gpu}: ${e.message}`);
        if (e instanceof GpuError && e.status === 502) break; // bad API key: no point trying other GPU types
      }
    }
    st.session = { ...st.session, status: 'failed', error: `No video GPU could be started — ${attempts.join('; ')}`, endedAt: new Date().toISOString() };
    await save(st);
    throw new GpuError(st.session.error!);
  });
}

/** Record the GPU as busy (a job was submitted or finished), so the idle timer restarts. */
export function touchVideoGpu(patch: Partial<Pick<VideoGpuSession, 'startupBilledTo'>> = {}) {
  return withGpuLock(async () => {
    const st = await load();
    if (!active(st.session)) return;
    st.session = { ...st.session, ...patch, lastActivityAt: new Date().toISOString() };
    await save(st);
  });
}

export function stopVideoGpu(reason: string): Promise<VideoGpuSession | null> {
  return withGpuLock(() => stopLocked(reason));
}

async function stopLocked(reason: string, failed = false): Promise<VideoGpuSession | null> {
  const c = videoGpuConfig();
  const st = await load();
  const s = st.session;
  if (!c || !s || !active(s)) return s;
  try {
    if (s.podId) await terminatePod(c, s.podId);
  } catch (e: any) {
    // keep "stopping" so the next check tries again (terminating is free; the pod's own timers are the backstop)
    st.session = { ...s, status: 'stopping', stopReason: reason, error: `Stopping the video GPU failed: ${e.message}` };
    await save(st);
    return st.session;
  }
  const ended = new Date().toISOString();
  const done: VideoGpuSession = { ...s, status: failed ? 'failed' : 'stopped', endedAt: ended, stopReason: reason, ...(failed ? { error: reason } : {}) };
  st.session = done;
  if (s.podId) st.ledger.push({ podId: s.podId, gpu: s.gpu, rate: s.rate, startedAt: s.createdAt, endedAt: ended, usd: sessionCost(done), reason });
  await save(st);
  return done;
}

export type ReadinessProbe = (url: string) => Promise<{ ready: boolean; phase?: string }>;

/**
 * Housekeeping, called every 30 s and on every status poll: readiness while starting, startup timeout, idle
 * shutdown, maximum session length and the monthly budget. `busy` = videos that still need the GPU.
 */
export function tickVideoGpu(busy: number, probe: ReadinessProbe): Promise<VideoGpuSession | null> {
  return withGpuLock(async () => {
    const c = videoGpuConfig();
    if (!c) return null;
    const st = await load();
    const s = st.session;
    if (!s || !active(s)) return s;
    const now = Date.now();
    const age = (now - Date.parse(s.createdAt)) / 60_000;
    if (s.status === 'stopping') return stopLocked(s.stopReason ?? 'stopping');
    if (monthSpend(st) > c.monthlyBudgetUsd) return stopLocked(`stopped: this month’s budget of $${c.monthlyBudgetUsd.toFixed(2)} was reached`, true);
    if (age > c.maxSessionMin) return stopLocked(`stopped: the GPU ran for its maximum of ${c.maxSessionMin} min`, busy > 0);
    if (s.status === 'starting') {
      if (!s.podId) {
        if (age > 2) return stopLocked('the GPU request never completed', true);
        return s;
      }
      if (age > c.startupTimeoutMin) return stopLocked(`the video GPU didn’t become ready within ${c.startupTimeoutMin} min`, true);
      if (busy === 0 && age > 2) return stopLocked('no video needs the GPU any more (cancelled while starting)');
      try {
        const pod = await runpod<PodInfo & { desiredStatus?: string }>(c, 'GET', `/pods/${encodeURIComponent(s.podId)}`);
        if (pod?.desiredStatus === 'EXITED' || pod?.desiredStatus === 'TERMINATED') {
          return stopLocked(`the video GPU stopped while starting (RunPod status ${pod.desiredStatus})`, true);
        }
        if (pod?.costPerHr && Number(pod.costPerHr) !== s.rate) s.rate = Number(pod.costPerHr);
      } catch {
        /* RunPod blip: try again next tick */
      }
      const r = await probe(s.url).catch(() => ({ ready: false, phase: undefined }));
      const next: VideoGpuSession = r.ready
        ? { ...s, status: 'ready', readyAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), phase: 'ready' }
        : { ...s, phase: r.phase ?? s.phase };
      st.session = next;
      await save(st);
      return next;
    }
    // ready
    if (busy === 0 && (now - Date.parse(s.lastActivityAt)) / 60_000 >= c.idleMin) return stopLocked(`stopped after ${c.idleMin} min without videos`);
    try {
      // stopped from outside (its own idle/lifetime timer, or the RunPod console)?
      const pod = await runpod<PodInfo>(c, 'GET', `/pods/${encodeURIComponent(s.podId)}`);
      if (pod?.desiredStatus === 'EXITED' || pod?.desiredStatus === 'TERMINATED') return stopLocked(`the video GPU was stopped outside the app (RunPod status ${pod.desiredStatus})`, busy > 0);
    } catch (e: any) {
      if (e instanceof GpuError && /→ 404/.test(e.message)) return stopLocked('the video GPU no longer exists on RunPod', busy > 0);
    }
    return s;
  });
}

/** Background housekeeping (once per server process). */
export function startVideoGpuTimer(fn: () => Promise<unknown>) {
  if (mem.timer || !videoGpuConfig()) return;
  mem.timer = setInterval(() => {
    fn().catch((e) => console.error('[video-gpu] housekeeping failed:', e?.message ?? e));
  }, 30_000);
  mem.timer.unref?.();
}

/** Kit downloads are allowed only for the session being started, with its own token. */
export async function kitTokenValid(token: string): Promise<boolean> {
  const s = (await load()).session;
  if (!s || !active(s) || !s.kitToken || token.length !== s.kitToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(s.kitToken), Buffer.from(token));
}
