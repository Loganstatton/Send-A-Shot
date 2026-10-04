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
import { builtinWorkflows } from '../comfy/builtin-workflows';
import type { AppSettings, CharacterProfile, GenerationRecord, Preset, StoredImage, WorkflowTemplate } from '../types';
import { imageSize } from './png';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

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

async function writeJsonAtomic(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
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
  const presets = doc?.presets?.length ? doc.presets : builtinPresets();
  return { version: 1, settings, character, workflows: doc?.workflows ?? [], presets };
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
  await writeJsonAtomic(HISTORY_FILE, list);
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
  const s = await getSettings();
  return (s.comfyUrl || process.env.COMFYUI_URL || 'mock').trim();
}

export function adultContentAllowed(): boolean {
  return process.env.ALLOW_ADULT_CONTENT === 'true';
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
  return (await listWorkflows()).find((w) => w.id === id) ?? null;
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

export function deleteRecord(id: string, deleteFiles = true): Promise<void> {
  return withLock(async () => {
    const list = await loadHistory();
    const rec = list.find((r) => r.id === id);
    await saveHistory(list.filter((r) => r.id !== id));
    if (rec && deleteFiles) {
      for (const img of rec.images) await fs.rm(path.join(IMAGES_DIR, img.file), { force: true });
    }
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

export async function storeImage(bytes: Buffer, mime: string, prefix: 'ref' | 'gen' | 'up', label?: string): Promise<StoredImage> {
  const ext = EXT_BY_MIME[mime.toLowerCase()];
  if (!ext) throw new Error(`Unsupported image type ${mime}. Use PNG, JPEG or WebP.`);
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  const id = newId();
  const file = `${prefix}_${id}.${ext}`;
  await fs.writeFile(path.join(IMAGES_DIR, file), bytes);
  const size = imageSize(bytes);
  return { id, file, width: size?.width, height: size?.height, label, createdAt: now() };
}

export async function readImage(file: string): Promise<{ bytes: Buffer; mime: string }> {
  if (!SAFE_FILE_RE.test(file)) throw new Error('Invalid file name');
  const bytes = await fs.readFile(path.join(IMAGES_DIR, file));
  const ext = file.split('.').pop()!.toLowerCase();
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return { bytes, mime };
}

export async function writeImageFile(file: string, bytes: Buffer) {
  if (!SAFE_FILE_RE.test(file)) throw new Error('Invalid file name');
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.writeFile(path.join(IMAGES_DIR, file), bytes);
}

export function mimeFromBytes(buf: Buffer): string | null {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
