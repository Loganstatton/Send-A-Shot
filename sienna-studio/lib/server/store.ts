/**
 * File-based persistence in DATA_DIR (default ./data):
 *
 *   data/config.json   settings, Sienna profile, custom workflows, presets
 *   data/history.json  generation records
 *   data/images/       reference uploads + generated images
 *
 * Writes are atomic (temp file + rename) and serialised through an in-process
 * lock. Run ONE app instance per DATA_DIR (the normal case for a personal app).
 */

import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { builtinPresets, DEFAULT_CHARACTER, DEFAULT_PARAMS, DEFAULT_SETTINGS } from '../defaults';
import { builtinWorkflows, LEGACY_WORKFLOW_IDS } from '../comfy/builtin-workflows';
import type { AppSettings, CharacterProfile, ClearedPhoto, GenerationRecord, Preset, StoredImage, StoredVideo, WorkflowTemplate } from '../types';
import { imageSize } from './png';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CLEARED_FILE = path.join(DATA_DIR, 'cleared-photos.json');

interface ConfigDoc {
  version: 1;
  settings: AppSettings;
  character: CharacterProfile;
  /** Custom workflows AND edited copies of built-ins (same id overrides). */
  workflows: WorkflowTemplate[];
  presets: Preset[];
}

interface Cache {
  config?: ConfigDoc;
  history?: GenerationRecord[];
  lock: Promise<unknown>;
}
const g = globalThis as unknown as { __siennaStore?: Cache };
const cache: Cache = (g.__siennaStore ??= { lock: Promise.resolve() });

export function newId(prefix = ''): string {
  return prefix + crypto.randomBytes(8).toString('hex');
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (e: any) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`Could not read ${file}: ${e.message}`);
  }
}

async function writeJsonAtomic(file: string, data: unknown, compact = false) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await withSpace(async () => {
    try {
      await fs.writeFile(tmp, compact ? JSON.stringify(data) : JSON.stringify(data, null, 2));
    } catch (e) {
      await fs.rm(tmp, { force: true }); // a half-written copy only takes the space a retry needs
      throw e;
    }
  });
  await fs.rename(tmp, file);
}

// ── Disk space ──────────────────────────────────────────────────────────────
// The 1 GB data disk filled up (2 Nov) with uploaded photos nothing used any more: deleting a record removes its
// results but never the photo it was made from, and every Copy Photo uploads its photo again. When a write runs out
// of space, those (and half-written .tmp files) are removed and the write is tried once more.

/** Uploaded photos (up_*) no record or setting refers to, older than `minAgeMs` (a fresh upload may not be used yet),
 * and leftover .tmp files: removed. Returns how many bytes were freed. */
export async function pruneUnusedUploads(minAgeMs = 60 * 60_000): Promise<number> {
  const inUse = referencedFiles(cache.history ?? (await readJson<GenerationRecord[]>(HISTORY_FILE)) ?? []);
  referencedFiles(cache.config ?? (await readJson<ConfigDoc>(CONFIG_FILE)), inUse);
  referencedFiles(await readJson<ClearedPhoto[]>(CLEARED_FILE), inUse);
  let freed = 0;
  const cutoff = Date.now() - minAgeMs;
  for (const [dir, test] of [[IMAGES_DIR, (f: string) => /^up_/.test(f) && SAFE_FILE_RE.test(f) && !inUse.has(f)], [DATA_DIR, (f: string) => f.endsWith('.tmp')]] as const) {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of names) {
      if (!test(f)) continue;
      const st = await fs.stat(path.join(dir, f)).catch(() => null);
      if (!st || !st.isFile() || st.mtimeMs > cutoff) continue;
      await fs.rm(path.join(dir, f), { force: true });
      freed += st.size;
    }
  }
  if (freed) console.warn(`store: freed ${(freed / 1e6).toFixed(1)} MB of unused uploads`);
  return freed;
}

/** Runs a disk write; when the disk is full, frees unused uploads and tries once more. */
async function withSpace<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e: any) {
    if (e?.code !== 'ENOSPC') throw e;
    if (!(await pruneUnusedUploads().catch(() => 0))) throw e;
    return write();
  }
}

/** Serialise read-modify-write operations. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = cache.lock.then(fn, fn);
  cache.lock = run.catch(() => undefined);
  return run;
}

function normaliseConfig(doc: Partial<ConfigDoc> | null): ConfigDoc {
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(doc?.settings ?? {}),
    defaultParams: { ...DEFAULT_PARAMS, ...(doc?.settings?.defaultParams ?? {}) },
  };
  const character: CharacterProfile = { ...DEFAULT_CHARACTER, ...(doc?.character ?? {}) };
  const legacy = (id: string | null) => (id && LEGACY_WORKFLOW_IDS[id]) || id;
  settings.defaultWorkflowId = legacy(settings.defaultWorkflowId);
  // built-in presets only for a config that never had any (deleting them all is kept)
  const presets = (Array.isArray(doc?.presets) ? doc!.presets : builtinPresets()).map((p) => ({ ...p, workflowId: legacy(p.workflowId) }));
  const workflows = (doc?.workflows ?? [])
    .filter((w) => !LEGACY_WORKFLOW_IDS[w.id])
    .map((w) => ({ ...w, optionalModules: w.optionalModules ?? ['init_image', 'face_reference_image', 'pose_image'] }));
  return { version: 1, settings, character, workflows, presets };
}

async function loadConfig(): Promise<ConfigDoc> {
  if (!cache.config) cache.config = normaliseConfig(await readJson<ConfigDoc>(CONFIG_FILE));
  return cache.config;
}

async function loadHistory(): Promise<GenerationRecord[]> {
  if (!cache.history) cache.history = (await readJson<GenerationRecord[]>(HISTORY_FILE)) ?? [];
  return cache.history;
}

async function saveConfig(doc: ConfigDoc) {
  cache.config = doc;
  await writeJsonAtomic(CONFIG_FILE, doc);
}

async function saveHistory(list: GenerationRecord[]) {
  cache.history = list;
  // compact: every record carries its whole workflow graph, and indenting it roughly doubled the file (2 Nov)
  await writeJsonAtomic(HISTORY_FILE, list, true);
}

const now = () => new Date().toISOString();

// ── Settings ────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  return (await loadConfig()).settings;
}

export function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return withLock(async () => {
    const doc = await loadConfig();
    doc.settings = {
      ...doc.settings,
      ...patch,
      defaultParams: { ...doc.settings.defaultParams, ...(patch.defaultParams ?? {}) },
      updatedAt: now(),
    };
    await saveConfig(doc);
    return doc.settings;
  });
}

/** Effective ComfyUI URL: settings override env. "mock" or empty → mock backend. */
export async function getComfyUrl(): Promise<string> {
  if (process.env.PHOTO_GPU === 'runpod') return (await onDemandPhotoUrl()) ?? PHOTO_GPU_OFF_URL;
  const s = await getSettings();
  return (s.comfyUrl || process.env.COMFYUI_URL || 'mock').trim();
}

/** Stands in for the ComfyUI address while the on-demand photo GPU is off (requests fail with a readable error). */
export const PHOTO_GPU_OFF_URL = 'http://photo-gpu-off.invalid';

/** The on-demand photo GPU's address (photo-gpu.ts keeps its state in DATA_DIR/photo-gpu.json; read here to avoid an import cycle). */
async function onDemandPhotoUrl(): Promise<string | null> {
  const s = (await readJson<{ session?: { status?: string; url?: string } | null }>(path.join(DATA_DIR, 'photo-gpu.json')).catch(() => null))?.session;
  return s && s.url && (s.status === 'starting' || s.status === 'ready' || s.status === 'stopping') ? s.url : null;
}

export function adultContentAllowed(): boolean {
  return process.env.ALLOW_ADULT_CONTENT === 'true';
}

/**
 * Untested-in-production quality experiments (pose retargeting, garment-only isolation,
 * prompt cleanup). Off unless SIENNA_EXPERIMENTAL=true: hidden in the UI and ignored by the server.
 */
export function experimentsEnabled(): boolean {
  return process.env.SIENNA_EXPERIMENTAL === 'true';
}

// ── Character ───────────────────────────────────────────────────────────────

export async function getCharacter(): Promise<CharacterProfile> {
  return (await loadConfig()).character;
}

export function updateCharacter(patch: Partial<CharacterProfile>): Promise<CharacterProfile> {
  return withLock(async () => {
    const doc = await loadConfig();
    doc.character = { ...doc.character, ...patch, updatedAt: now() };
    await saveConfig(doc);
    return doc.character;
  });
}

// ── Workflows ───────────────────────────────────────────────────────────────

export async function listWorkflows(): Promise<WorkflowTemplate[]> {
  const doc = await loadConfig();
  const byId = new Map<string, WorkflowTemplate>();
  for (const w of builtinWorkflows()) byId.set(w.id, w);
  for (const w of doc.workflows) byId.set(w.id, w);
  return [...byId.values()];
}

export async function getWorkflow(id: string): Promise<WorkflowTemplate | null> {
  const real = LEGACY_WORKFLOW_IDS[id] ?? id;
  return (await listWorkflows()).find((w) => w.id === real) ?? null;
}

export function saveWorkflow(wf: WorkflowTemplate): Promise<WorkflowTemplate> {
  return withLock(async () => {
    const doc = await loadConfig();
    const saved = { ...wf, updatedAt: now() };
    doc.workflows = [...doc.workflows.filter((w) => w.id !== wf.id), saved];
    await saveConfig(doc);
    return saved;
  });
}

/** Delete a custom workflow, or reset an edited built-in to its original. */
export function deleteWorkflow(id: string): Promise<void> {
  return withLock(async () => {
    const doc = await loadConfig();
    doc.workflows = doc.workflows.filter((w) => w.id !== id);
    const stillExists = builtinWorkflows().some((w) => w.id === id);
    if (!stillExists) {
      doc.presets = doc.presets.map((p) => (p.workflowId === id ? { ...p, workflowId: null } : p));
      if (doc.settings.defaultWorkflowId === id) doc.settings.defaultWorkflowId = DEFAULT_SETTINGS.defaultWorkflowId;
    }
    await saveConfig(doc);
  });
}

// ── Presets ─────────────────────────────────────────────────────────────────

export async function listPresets(): Promise<Preset[]> {
  return (await loadConfig()).presets;
}

export function savePreset(p: Preset): Promise<Preset> {
  return withLock(async () => {
    const doc = await loadConfig();
    const saved = { ...p, updatedAt: now() };
    const idx = doc.presets.findIndex((x) => x.id === p.id);
    if (idx >= 0) doc.presets[idx] = saved;
    else doc.presets.push(saved);
    await saveConfig(doc);
    return saved;
  });
}

export function deletePreset(id: string): Promise<void> {
  return withLock(async () => {
    const doc = await loadConfig();
    doc.presets = doc.presets.filter((p) => p.id !== id);
    await saveConfig(doc);
  });
}

/** Restore the built-in presets (keeps custom ones). */
export function resetBuiltinPresets(): Promise<Preset[]> {
  return withLock(async () => {
    const doc = await loadConfig();
    const builtins = builtinPresets();
    const ids = new Set(builtins.map((b) => b.id));
    doc.presets = [...builtins, ...doc.presets.filter((p) => !ids.has(p.id))];
    await saveConfig(doc);
    return doc.presets;
  });
}

// ── Whole-config import/export ──────────────────────────────────────────────

export async function getConfigSnapshot() {
  const doc = await loadConfig();
  return { settings: doc.settings, character: doc.character, workflows: doc.workflows, presets: doc.presets };
}

export function replaceConfig(next: Pick<ConfigDoc, 'settings' | 'character' | 'workflows' | 'presets'>) {
  return withLock(async () => {
    await saveConfig(normaliseConfig({ version: 1, ...next }));
  });
}

// ── History ─────────────────────────────────────────────────────────────────

export async function listHistory(): Promise<GenerationRecord[]> {
  return [...(await loadHistory())].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRecord(id: string): Promise<GenerationRecord | null> {
  return (await loadHistory()).find((r) => r.id === id) ?? null;
}

export function saveRecord(rec: GenerationRecord): Promise<GenerationRecord> {
  return withLock(async () => {
    const list = await loadHistory();
    const idx = list.findIndex((r) => r.id === rec.id);
    const next = idx >= 0 ? list.map((r) => (r.id === rec.id ? rec : r)) : [...list, rec];
    await saveHistory(next);
    return rec;
  });
}

export function patchRecord(id: string, patch: Partial<GenerationRecord>): Promise<GenerationRecord | null> {
  return withLock(async () => {
    const list = await loadHistory();
    const rec = list.find((r) => r.id === id);
    if (!rec) return null;
    const updated = { ...rec, ...patch, id: rec.id };
    await saveHistory(list.map((r) => (r.id === id ? updated : r)));
    return updated;
  });
}

/** Every stored file name an object refers to (any `file` field that is a safe stored-file name), at any depth. */
export function referencedFiles(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) referencedFiles(v, into);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'file' && typeof v === 'string' && (SAFE_FILE_RE.test(v) || SAFE_VIDEO_RE.test(v))) into.add(v);
      else if (k !== 'submittedGraph') referencedFiles(v, into);
    }
  }
  return into;
}

/** The files a record made or brought in for itself (removed with it unless something else still uses them). */
export function ownedFiles(rec: GenerationRecord): string[] {
  const v = rec.video;
  const e = rec.outfitEdit;
  return [
    ...rec.images.map((i) => i.file),
    v?.result?.file, v?.lockCamera?.result?.file, v?.drive?.video.file, v?.drive?.poster.file, v?.safeFraming?.framedImage?.file,
    e?.referenceCrop?.file, e?.redraw?.preview?.file,
  ].filter((f): f is string => !!f && (SAFE_FILE_RE.test(f) || SAFE_VIDEO_RE.test(f)));
}

export function deleteRecord(id: string, deleteFiles = true): Promise<void> {
  return withLock(async () => {
    const list = await loadHistory();
    const rec = list.find((r) => r.id === id);
    const rest = list.filter((r) => r.id !== id);
    // its files go first: on a full disk the shorter history could not be written until something was freed (2 Nov)
    if (rec && deleteFiles) {
      // a file still used elsewhere stays: re-runs share a driving video, a photo can be a body reference, and a
      // record's file names come partly from the client (a video's poster), so never trust them to be its own alone
      const inUse = referencedFiles(rest);
      referencedFiles((await loadConfig()).character, inUse);
      const own = [...ownedFiles(rec), ...[rec.initImage?.file, rec.poseImage?.file].filter((f): f is string => !!f && /^up_/.test(f) && SAFE_FILE_RE.test(f))];
      for (const f of new Set(own)) if (!inUse.has(f)) await fs.rm(path.join(IMAGES_DIR, f), { force: true });
    }
    await saveHistory(rest);
  });
}

// ── Images ──────────────────────────────────────────────────────────────────

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

export const SAFE_FILE_RE = /^[a-z0-9_-]+\.(png|jpg|webp)$/i;
/** Video Studio files: vid_* (results) and mot_* (driving videos), MP4 only. */
export const SAFE_VIDEO_RE = /^(vid|mot)_[a-z0-9]+\.mp4$/i;

/** Absolute path of a stored image or video, or null for an unsafe name. */
export function storedFilePath(file: string): string | null {
  return SAFE_FILE_RE.test(file) || SAFE_VIDEO_RE.test(file) ? path.join(IMAGES_DIR, file) : null;
}

/** Move a finished MP4 into storage. */
export async function storeVideoFile(src: string, prefix: 'vid' | 'mot', info: Omit<StoredVideo, 'id' | 'file' | 'bytes' | 'createdAt'>): Promise<StoredVideo> {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  const id = newId();
  const file = `${prefix}_${id}.mp4`;
  const dest = path.join(IMAGES_DIR, file);
  // copy (not rename): the scratch file may be on another filesystem than the persistent disk
  await fs.copyFile(src, dest);
  const { size } = await fs.stat(dest);
  return { id, file, bytes: size, createdAt: now(), ...info };
}

export async function readVideo(file: string): Promise<Buffer> {
  if (!SAFE_VIDEO_RE.test(file)) throw new Error('Invalid file name');
  return fs.readFile(path.join(IMAGES_DIR, file)).catch((e) => {
    throw e?.code === 'ENOENT' ? new MissingImageError(file) : e;
  });
}

export async function storeImage(bytes: Buffer, mime: string, prefix: 'ref' | 'gen' | 'up', label?: string): Promise<StoredImage> {
  const ext = EXT_BY_MIME[mime.toLowerCase()];
  if (!ext) throw new Error(`Unsupported image type ${mime}. Use PNG, JPEG or WebP.`);
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  const id = newId();
  const file = `${prefix}_${id}.${ext}`;
  await withSpace(() => fs.writeFile(path.join(IMAGES_DIR, file), bytes));
  const size = imageSize(bytes);
  return { id, file, width: size?.width, height: size?.height, label, createdAt: now() };
}

/** A stored image that is gone, e.g. after a restart on a host without a persistent disk. */
export class MissingImageError extends Error {
  status = 410;
  constructor(file: string) {
    super(`A photo used here (${file}) is no longer on the server — the app restarted and lost its storage. Remove that photo and add it again.`);
  }
}

export async function readImage(file: string): Promise<{ bytes: Buffer; mime: string }> {
  if (!SAFE_FILE_RE.test(file)) throw new Error('Invalid file name');
  const bytes = await fs.readFile(path.join(IMAGES_DIR, file)).catch((e) => {
    throw e?.code === 'ENOENT' ? new MissingImageError(file) : e;
  });
  const ext = file.split('.').pop()!.toLowerCase();
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return { bytes, mime };
}

export async function writeImageFile(file: string, bytes: Buffer) {
  if (!SAFE_FILE_RE.test(file)) throw new Error('Invalid file name');
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await withSpace(() => fs.writeFile(path.join(IMAGES_DIR, file), bytes));
}

export function mimeFromBytes(buf: Buffer): string | null {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// ── Photo Swap: the cleared photo library ─────────────────────────────────────

export async function listClearedPhotos(): Promise<ClearedPhoto[]> {
  return (await readJson<ClearedPhoto[]>(CLEARED_FILE)) ?? [];
}

export async function getClearedPhoto(id: string): Promise<ClearedPhoto | null> {
  return (await listClearedPhotos()).find((c) => c.id === id) ?? null;
}

/** Adds a photo to the library. The model's name or handle and the consent confirmation are both required. */
export function addClearedPhoto(image: StoredImage, model: string, consent: boolean): Promise<ClearedPhoto> {
  const name = model.trim().slice(0, 120);
  if (!name) throw Object.assign(new Error('Enter the model’s name or handle.'), { status: 400 });
  if (consent !== true) throw Object.assign(new Error('Confirm that she agreed to her photos being used with Sienna’s face.'), { status: 400 });
  return withLock(async () => {
    const list = await listClearedPhotos();
    const item: ClearedPhoto = { id: newId('c'), image, model: name, consent: true, consentedAt: now() };
    await writeJsonAtomic(CLEARED_FILE, [item, ...list]);
    return item;
  });
}

/** Removes a photo from the library and deletes its file. */
export function deleteClearedPhoto(id: string): Promise<boolean> {
  return withLock(async () => {
    const list = await listClearedPhotos();
    const item = list.find((c) => c.id === id);
    if (!item) return false;
    await writeJsonAtomic(CLEARED_FILE, list.filter((c) => c.id !== id));
    if (SAFE_FILE_RE.test(item.image.file)) await fs.rm(path.join(IMAGES_DIR, item.image.file), { force: true });
    return true;
  });
}
