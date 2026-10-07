'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fileUrl, useApi } from '@/lib/client/api';
import { Draft, useDraft } from '@/lib/client/draft';
import { JOBS_KEY } from '@/lib/client/jobs';
import { capabilities } from '@/lib/comfy/adapter';
import { DEFAULT_PARAMS, EMPTY_FIELDS, SIZE_PRESETS } from '@/lib/defaults';
import { applyIdentityLock, findHardBlocks } from '@/lib/guard';
import { buildPrompt } from '@/lib/prompt';
import { SIENNA_MODELS, resolveLockedLora } from '@/lib/sienna-models';
import type { AppSettings, CharacterProfile, GenerationRecord, Preset, PromptFields, WorkflowTemplate } from '@/lib/types';
import { PROMPT_FIELD_LABELS } from '@/lib/types';
import { ImagePicker } from './ImagePicker';
import { JobCard } from './JobCard';
import { Badge, Button, Card, Chip, Collapsible, Notice, PageHeader, SectionTitle, Select, Slider, Spinner, TextArea, Toggle, cx, toast } from './ui';

interface SettingsPayload {
  settings: AppSettings;
  env: { adultContentAllowed: boolean; mock: boolean; effectiveComfyUrl: string };
}

const PLACEHOLDERS: Record<keyof PromptFields, string> = {
  outfit: 'e.g. oversized grey hoodie, bike shorts',
  pose: 'e.g. leaning against the kitchen counter',
  bodyPresentation: 'e.g. relaxed posture, one hip popped',
  expression: 'e.g. teasing half smile',
  setting: 'e.g. small apartment kitchen at night',
  lighting: 'e.g. warm under-cabinet lights',
  camera: 'blank = profile default camera style',
  framing: 'e.g. waist-up, slightly off-center',
  realism: 'added to the profile realism prompt',
  extra: 'anything else',
};

const SCENE_KEYS: (keyof PromptFields)[] = ['outfit', 'pose', 'bodyPresentation', 'expression', 'setting', 'lighting'];
const CAMERA_KEYS: (keyof PromptFields)[] = ['camera', 'framing', 'realism', 'extra'];


export function CreateScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const { draft, setDraft, isNew } = useDraft();

  const settingsQ = useApi<SettingsPayload>('/api/settings');
  const characterQ = useApi<CharacterProfile>('/api/character');
  const presetsQ = useApi<Preset[]>('/api/presets');
  const workflowsQ = useApi<WorkflowTemplate[]>('/api/workflows');

  const settings = settingsQ.data?.settings;
  const env = settingsQ.data?.env;
  const character = characterQ.data;
  const presets = presetsQ.data ?? [];
  const workflows = workflowsQ.data ?? [];

  // First launch → setup wizard.
  useEffect(() => {
    if (settings && !settings.setupComplete) router.replace('/setup');
  }, [settings, router]);

  const workflowId = draft?.workflowId || presets.find((p) => p.id === draft?.presetId)?.workflowId || settings?.defaultWorkflowId || '';
  const workflow = workflows.find((w) => w.id === workflowId) ?? null;
  const caps = useMemo(() => capabilities(workflow?.bindings ?? {}), [workflow]);

  const optionsQ = useApi<{ options: Record<string, string[]>; error: string | null }>(workflowId ? `/api/comfy/options?workflowId=${encodeURIComponent(workflowId)}` : null);
  const opts = optionsQ.data?.options ?? {};

  // ── Load from a history record (?from=id → edit & regenerate, ?init=id → img2img) ──
  const handledQuery = useRef(false);
  useEffect(() => {
    if (!draft || handledQuery.current) return;
    const from = search.get('from');
    const init = search.get('init');
    if (!from && !init) return;
    handledQuery.current = true;
    api<GenerationRecord>(`/api/history/${from || init}`)
      .then((rec) => {
        if (from) {
          setDraft((d) => ({
            ...d,
            presetId: rec.presetId,
            workflowId: rec.workflowId,
            siennaLock: rec.siennaLock,
            contentMode: rec.contentMode,
            fields: { ...EMPTY_FIELDS, ...rec.fields },
            params: { ...DEFAULT_PARAMS, ...rec.params, seed: rec.seed },
            images: { initImage: rec.initImage, poseImage: rec.poseImage, faceReferenceId: rec.faceReference?.id ?? null },
            parentId: rec.id,
          }));
          toast('Loaded settings from gallery — edit and generate.');
        } else if (rec.images[0]) {
          const i2i = workflows.find((w) => capabilities(w.bindings).img2img);
          setDraft((d) => ({
            ...d,
            workflowId: i2i?.id ?? d.workflowId,
            images: { ...d.images, initImage: rec.images[0] },
            params: { ...d.params, denoise: 0.5 },
            parentId: rec.id,
          }));
          toast(i2i ? `Using image as init for “${i2i.name}”.` : 'No img2img workflow found — add one in Library.', i2i ? 'ok' : 'error');
        }
        router.replace('/');
      })
      .catch((e) => toast(e.message, 'error'));
  }, [draft, search, setDraft, router, workflows]);

  // Apply the content mode / lock defaults the first time settings arrive.
  const appliedDefaults = useRef(false);
  useEffect(() => {
    if (!settings || !character || !draft || appliedDefaults.current) return;
    appliedDefaults.current = true;
    if (isNew) {
      // Fresh device: start from the server-side defaults and the profile's LoRA weights.
      setDraft((d) => ({
        ...d,
        siennaLock: settings.siennaLockDefault,
        contentMode: settings.contentMode,
        params: { ...d.params, ...settings.defaultParams, loraStrength: character.loraWeight, loraClipStrength: character.loraClipWeight },
      }));
    }
    if (!env?.adultContentAllowed && draft.contentMode === 'adult') setDraft((d) => ({ ...d, contentMode: 'sfw' }));
  }, [settings, env, character, draft, isNew, setDraft]);

  // ── Jobs (polling) ──
  const [jobs, setJobs] = useState<GenerationRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const scrollToJobs = useRef(false);

  // Scroll up after the new job card is in the DOM (scrolling before would be
  // undone by the browser's scroll anchoring when the card is inserted).
  useEffect(() => {
    if (!scrollToJobs.current) return;
    scrollToJobs.current = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [jobs]);

  useEffect(() => {
    try {
      const ids: string[] = JSON.parse(sessionStorage.getItem(JOBS_KEY) || '[]');
      Promise.all(ids.map((id) => api<GenerationRecord>(`/api/history/${id}`).catch(() => null))).then((recs) =>
        setJobs(recs.filter(Boolean) as GenerationRecord[]),
      );
    } catch {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, 6).map((j) => j.id)));
    } catch {}
  }, [jobs]);

  const pending = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (pending.length === 0) return;
    const t = setInterval(async () => {
      const updates = await Promise.all(pending.map((j) => api<GenerationRecord>(`/api/history/${j.id}/status`).catch(() => null)));
      setJobs((prev) => prev.map((j) => updates.find((u) => u?.id === j.id) ?? j));
      for (const u of updates) {
        if (u?.status === 'done' && 'vibrate' in navigator) navigator.vibrate?.(30);
      }
    }, 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.map((j) => j.id + j.status).join(',')]);

  // ── Prompt preview ──
  const built = useMemo(() => {
    if (!draft || !character) return null;
    return buildPrompt({ fields: draft.fields, character, siennaLock: draft.siennaLock, contentMode: draft.contentMode });
  }, [draft, character]);

  const update = useCallback((fn: (d: Draft) => Draft) => setDraft(fn), [setDraft]);
  const setField = (k: keyof PromptFields, v: string) => update((d) => ({ ...d, fields: { ...d.fields, [k]: v } }));
  const setParam = <K extends keyof Draft['params']>(k: K, v: Draft['params'][K]) => update((d) => ({ ...d, params: { ...d.params, [k]: v } }));

  function applyPreset(p: Preset) {
    update((d) => ({
      ...d,
      presetId: p.id,
      workflowId: p.workflowId ?? null,
      fields: { ...EMPTY_FIELDS, ...p.fields },
      params: { ...d.params, ...p.params },
      parentId: undefined,
    }));
  }

  async function saveAsPreset() {
    if (!draft) return;
    const name = prompt('Preset name?');
    if (!name) return;
    try {
      const p = await api<Preset>('/api/presets', {
        method: 'POST',
        json: {
          name,
          emoji: '⭐',
          fields: draft.fields,
          params: { width: draft.params.width, height: draft.params.height, steps: draft.params.steps, cfg: draft.params.cfg },
          workflowId: draft.workflowId,
        },
      });
      await presetsQ.reload();
      update((d) => ({ ...d, presetId: p.id }));
      toast(`Saved preset “${p.name}”`);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function generate() {
    if (!draft) return;
    if (built?.blocked.length) {
      toast(`Blocked: “${built.blocked[0].term}” — ${built.blocked[0].reason}`, 'error');
      return;
    }
    setSubmitting(true);
    try {
      const rec = await api<GenerationRecord>('/api/generate', {
        method: 'POST',
        json: {
          presetId: draft.presetId,
          workflowId: workflowId || null,
          siennaLock: draft.siennaLock,
          contentMode: draft.contentMode,
          fields: draft.fields,
          params: draft.params,
          images: draft.images,
          parentId: draft.parentId,
        },
      });
      scrollToJobs.current = true;
      setJobs((prev) => [rec, ...prev].slice(0, 6));
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!draft || !settings || !character) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-ink-400">
        <Spinner />
      </div>
    );
  }

  const lockedLora = resolveLockedLora(character.loraFilename, draft.params.siennaModel).file;
  const abModel = SIENNA_MODELS.find((m) => m.file === draft.params.siennaModel);
  const refs = [character.faceReference, ...character.secondaryReferences].filter(Boolean) as NonNullable<CharacterProfile['faceReference']>[];
  const activeRefId = draft.images.faceReferenceId ?? character.faceReference?.id ?? null;
  const fieldWarning = (k: keyof PromptFields) => {
    const v = draft.fields[k];
    if (!v) return undefined;
    const hard = findHardBlocks(v);
    if (hard.length) return `⛔ “${hard[0].term}”: ${hard[0].reason}`;
    if (draft.siennaLock) {
      const r = applyIdentityLock(v, character.extraLockedTerms);
      if (r.removed.length) return `🔒 Will be removed: ${r.removed.map((x) => `“${x.term}” (${x.category})`).join(', ')}`;
    }
    return undefined;
  };

  return (
    <div className="pb-nav-action">
      <PageHeader
        title="Create"
        subtitle={workflow ? workflow.name : 'No workflow selected'}
        right={
          <Link href="/diagnostics">
            <Badge tone={env?.mock ? 'warn' : 'ok'}>{env?.mock ? 'MOCK' : 'ComfyUI live'}</Badge>
          </Link>
        }
      />

      {jobs.length > 0 && (
        <div className="space-y-3">
          {jobs.slice(0, 3).map((j) => (
            <JobCard key={j.id} job={j} onDismiss={() => setJobs((prev) => prev.filter((x) => x.id !== j.id))} />
          ))}
        </div>
      )}

      {/* ── Sienna Lock ── */}
      <Card className={cx('mt-3', draft.siennaLock && 'ring-accent/60')}>
        <Toggle
          checked={draft.siennaLock}
          onChange={(v) => update((d) => ({ ...d, siennaLock: v }))}
          label={<span className="font-semibold">🔒 Sienna Lock</span>}
          description={draft.siennaLock ? 'Identity fixed: LoRA, face reference and core traits are injected; identity edits are stripped.' : 'Off — free prompt, nothing injected.'}
        />
        {draft.siennaLock && (
          <div className="mt-3 flex items-center gap-3 border-t border-ink-800 pt-3">
            {character.faceReference ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(refs.find((r) => r.id === activeRefId)?.file ?? character.faceReference.file)} alt="" className="h-14 w-14 rounded-xl object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-ink-800 text-[10px] text-ink-400">no ref</div>
            )}
            <div className="min-w-0 flex-1 text-xs text-ink-400">
              <p className="truncate">
                <span className="text-ink-200">Token</span> {character.triggerToken || '—'}
              </p>
              <p className="truncate">
                <span className="text-ink-200">LoRA</span> {lockedLora || <span className="text-amber-400">not set</span>} @ {draft.params.loraStrength}
              </p>
              <p className="truncate">
                <span className="text-ink-200">Face ref</span>{' '}
                {caps.faceReference ? (character.faceReference ? 'applied' : <span className="text-amber-400">missing</span>) : 'not in this workflow'}
              </p>
            </div>
            <Link href="/character" className="text-xs text-accent">
              Edit
            </Link>
          </div>
        )}
        {draft.siennaLock && (
          <Select
            className="mt-3"
            label="Sienna model"
            value={draft.params.siennaModel ?? ''}
            onChange={(v) => setParam('siennaModel', v)}
            options={[
              { value: '', label: `Profile default (${character.loraFilename || 'not set'})` },
              ...SIENNA_MODELS.filter((m) => m.file !== character.loraFilename).map((m) => ({ value: m.file, label: m.label })),
            ]}
            hint={abModel ? <span className="text-amber-400">A/B: {abModel.note}</span> : undefined}
          />
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-ink-800 pt-3">
          {(['sfw', 'adult'] as const).map((m) => (
            <Chip
              key={m}
              active={draft.contentMode === m}
              onClick={() => {
                if (m === 'adult' && !env?.adultContentAllowed) {
                  toast('Adult mode is disabled on this server. Set ALLOW_ADULT_CONTENT=true only if your model and GPU host permit it.', 'error');
                  return;
                }
                update((d) => ({ ...d, contentMode: m }));
              }}
              className={cx('w-full', m === 'adult' && !env?.adultContentAllowed && 'opacity-40')}
            >
              {m === 'sfw' ? 'SFW' : 'Adult 18+'}
            </Chip>
          ))}
        </div>
      </Card>

      {/* ── Presets ── */}
      <SectionTitle
        right={
          <button className="text-xs text-accent" onClick={saveAsPreset}>
            + Save current
          </button>
        }
      >
        Presets
      </SectionTitle>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {presets.map((p) => (
          <Chip key={p.id} active={draft.presetId === p.id} onClick={() => applyPreset(p)}>
            {p.emoji} {p.name}
          </Chip>
        ))}
        <Link href="/library" className="flex min-h-[40px] shrink-0 items-center rounded-full px-4 text-sm text-ink-400 ring-1 ring-ink-700">
          Manage…
        </Link>
      </div>

      {/* ── Prompt builder ── */}
      <SectionTitle
        right={
          <button
            className="text-xs text-ink-400"
            onClick={() => {
              if (confirm('Clear all prompt fields?')) update((d) => ({ ...d, presetId: null, fields: { ...EMPTY_FIELDS } }));
            }}
          >
            Clear
          </button>
        }
      >
        Prompt builder
      </SectionTitle>
      <div className="space-y-3">
        <Collapsible title="Outfit, pose & scene" defaultOpen>
          {SCENE_KEYS.map((k) => (
            <TextArea
              key={k}
              label={PROMPT_FIELD_LABELS[k]}
              value={draft.fields[k]}
              placeholder={PLACEHOLDERS[k]}
              onChange={(e) => setField(k, e.target.value)}
              warning={fieldWarning(k)}
            />
          ))}
        </Collapsible>

        <Collapsible title="Camera, framing & realism">
          {CAMERA_KEYS.map((k) => (
            <TextArea
              key={k}
              label={PROMPT_FIELD_LABELS[k]}
              value={draft.fields[k]}
              placeholder={k === 'camera' && draft.siennaLock ? character.defaultCameraStyle : PLACEHOLDERS[k]}
              onChange={(e) => setField(k, e.target.value)}
              warning={fieldWarning(k)}
            />
          ))}
        </Collapsible>

        {/* ── Reference images ── */}
        <Collapsible
          title="Reference images"
          badge={(draft.images.initImage || draft.images.poseImage) && <Badge tone="accent">set</Badge>}
        >
          {refs.length > 0 && (
            <div>
              <p className="mb-1 text-sm text-ink-200">
                Face reference {!caps.faceReference && <span className="text-xs text-ink-400">(this workflow has no face input)</span>}
              </p>
              <div className="no-scrollbar flex gap-2 overflow-x-auto">
                {!draft.siennaLock && (
                  <button
                    onClick={() => update((d) => ({ ...d, images: { ...d.images, faceReferenceId: null } }))}
                    className={cx('flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-xs', !draft.images.faceReferenceId && 'ring-2 ring-accent')}
                  >
                    None
                  </button>
                )}
                {refs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => update((d) => ({ ...d, images: { ...d.images, faceReferenceId: r.id } }))}
                    className={cx('h-20 w-16 shrink-0 overflow-hidden rounded-lg', (draft.siennaLock ? activeRefId : draft.images.faceReferenceId) === r.id && 'ring-2 ring-accent')}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrl(r.file)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <ImagePicker
              label="Init image (img2img)"
              value={draft.images.initImage}
              onChange={(img) => update((d) => ({ ...d, images: { ...d.images, initImage: img } }))}
              disabled={!caps.img2img}
              hint={caps.img2img ? undefined : 'Pick an img2img workflow'}
            />
            <ImagePicker
              label="Pose / ControlNet"
              value={draft.images.poseImage}
              onChange={(img) => update((d) => ({ ...d, images: { ...d.images, poseImage: img } }))}
              disabled={!caps.pose}
              hint={caps.pose ? 'OpenPose skeleton or a photo for the preprocessor' : 'Pick a ControlNet workflow'}
            />
          </div>
          {caps.img2img && (
            <Slider label="Denoise strength" hint="lower = closer to init" value={draft.params.denoise} min={0.05} max={1} step={0.01} onChange={(v) => setParam('denoise', v)} />
          )}
          {caps.pose && (
            <Slider label="Pose strength" value={draft.params.controlStrength} min={0} max={1.5} step={0.05} onChange={(v) => setParam('controlStrength', v)} />
          )}
          {caps.faceReference && (
            <Slider label="Face reference weight" value={draft.params.faceStrength} min={0} max={1.5} step={0.05} onChange={(v) => setParam('faceStrength', v)} />
          )}
        </Collapsible>

        {/* ── Advanced ── */}
        <Collapsible title="Advanced generation settings">
          <Select
            label="Workflow"
            value={workflowId}
            onChange={(v) => update((d) => ({ ...d, workflowId: v || null }))}
            options={workflows.map((w) => ({ value: w.id, label: w.name }))}
          />
          {caps.checkpoint && (
            <Select
              label="Model"
              value={draft.params.checkpoint}
              onChange={(v) => setParam('checkpoint', v)}
              placeholder="(workflow default)"
              options={(opts.checkpoint ?? []).map((o) => ({ value: o, label: o }))}
            />
          )}
          {draft.siennaLock ? (
            <p className="text-sm text-ink-400">
              LoRA locked to <span className="text-ink-200">{lockedLora || 'not set'}</span>
            </p>
          ) : (
            <Select
              label="LoRA"
              value={draft.params.loraName}
              onChange={(v) => setParam('loraName', v)}
              placeholder="(none)"
              options={(opts.lora_name ?? []).map((o) => ({ value: o, label: o }))}
            />
          )}
          <Slider label="LoRA strength" value={draft.params.loraStrength} min={0} max={1.5} step={0.05} onChange={(v) => setParam('loraStrength', v)} />
          <Slider label="LoRA CLIP strength" value={draft.params.loraClipStrength} min={0} max={1.5} step={0.05} onChange={(v) => setParam('loraClipStrength', v)} />
          {caps.faceRefine && (
            <>
              <Toggle
                checked={draft.params.faceRefine ?? DEFAULT_PARAMS.faceRefine}
                onChange={(v) => setParam('faceRefine', v)}
                label="Face refinement for small faces"
                description={`Redraws Sienna’s face when it is under ${draft.params.faceRefineThreshold ?? DEFAULT_PARAMS.faceRefineThreshold}px (full-body, mirror shots). Larger faces are left as they are.`}
              />
              {(draft.params.faceRefine ?? DEFAULT_PARAMS.faceRefine) && (
                <Slider
                  label="Face refinement strength"
                  hint="denoise · lower keeps expression and lighting"
                  value={draft.params.faceRefineDenoise ?? DEFAULT_PARAMS.faceRefineDenoise}
                  min={0.1}
                  max={0.5}
                  step={0.05}
                  onChange={(v) => setParam('faceRefineDenoise', v)}
                />
              )}
            </>
          )}

          <div>
            <p className="mb-1 text-sm text-ink-200">Seed</p>
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                value={draft.params.seed < 0 ? '' : String(draft.params.seed)}
                placeholder="random"
                onChange={(e) => {
                  const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
                  setParam('seed', Number.isFinite(n) ? n : -1);
                }}
                className="min-w-0 flex-1 rounded-xl bg-ink-800 px-3 py-3 text-base ring-1 ring-ink-700"
              />
              <Button onClick={() => setParam('seed', -1)} aria-label="Random seed">
                🎲
              </Button>
              {jobs[0] && (
                <Button onClick={() => setParam('seed', jobs[0].seed)} aria-label="Reuse last seed">
                  ♻︎ last
                </Button>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1 text-sm text-ink-200">Size</p>
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
              {SIZE_PRESETS.map((s) => (
                <Chip
                  key={s.label}
                  active={draft.params.width === s.width && draft.params.height === s.height}
                  onClick={() => update((d) => ({ ...d, params: { ...d.params, width: s.width, height: s.height } }))}
                >
                  {s.label}
                </Chip>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Slider label="Width" value={draft.params.width} min={512} max={1536} step={64} onChange={(v) => setParam('width', v)} />
              <Slider label="Height" value={draft.params.height} min={512} max={1536} step={64} onChange={(v) => setParam('height', v)} />
            </div>
          </div>

          <Slider label="Steps" value={draft.params.steps} min={4} max={80} step={1} onChange={(v) => setParam('steps', v)} />
          <Slider
            label={caps.guidance ? 'Guidance (Flux)' : 'CFG'}
            value={draft.params.cfg}
            min={1}
            max={12}
            step={0.1}
            onChange={(v) => setParam('cfg', v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="Sampler"
              value={draft.params.sampler}
              disabled={!caps.sampler}
              onChange={(v) => setParam('sampler', v)}
              placeholder="(workflow)"
              options={(opts.sampler ?? []).map((o) => ({ value: o, label: o }))}
            />
            <Select
              label="Scheduler"
              value={draft.params.scheduler}
              disabled={!caps.scheduler}
              onChange={(v) => setParam('scheduler', v)}
              placeholder="(workflow)"
              options={(opts.scheduler ?? []).map((o) => ({ value: o, label: o }))}
            />
          </div>
          {caps.controlnetModel && (
            <Select
              label="ControlNet model"
              value={draft.params.controlnetModel}
              onChange={(v) => setParam('controlnetModel', v)}
              placeholder="(workflow default)"
              options={(opts.controlnet_model ?? []).map((o) => ({ value: o, label: o }))}
            />
          )}
          <Slider label="Images per run" value={draft.params.batchSize} min={1} max={4} step={1} onChange={(v) => setParam('batchSize', v)} />
          {optionsQ.data?.error && <Notice kind="warn">Couldn’t load model lists: {optionsQ.data.error}</Notice>}
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => update((d) => ({ ...d, params: { ...DEFAULT_PARAMS, ...settings.defaultParams, loraStrength: character.loraWeight, loraClipStrength: character.loraClipWeight } }))}
          >
            Reset to defaults
          </Button>
        </Collapsible>

        {/* ── Final prompt ── */}
        <Collapsible
          title="Final prompt"
          badge={
            built && (built.blocked.length ? <Badge tone="error">blocked</Badge> : built.warnings.length ? <Badge tone="warn">{built.warnings.length}</Badge> : null)
          }
        >
          {built && (
            <>
              {built.blocked.map((b, i) => (
                <Notice key={i} kind="error">
                  “{b.term}” — {b.reason}
                </Notice>
              ))}
              {built.warnings.map((w, i) => (
                <Notice key={i} kind="warn">
                  {w}
                </Notice>
              ))}
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ink-400">Positive</p>
                <p className="select-text whitespace-pre-wrap rounded-xl bg-ink-800 p-3 text-sm leading-relaxed">{built.positive}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ink-400">Negative</p>
                <p className="select-text whitespace-pre-wrap rounded-xl bg-ink-800 p-3 text-sm leading-relaxed text-ink-400">{built.negative}</p>
              </div>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => navigator.clipboard?.writeText(built.positive).then(() => toast('Copied'))}
              >
                Copy positive prompt
              </Button>
            </>
          )}
        </Collapsible>
      </div>

      {/* ── Sticky Generate ── */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-20 border-t border-ink-800 bg-ink-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl gap-2">
          <Button
            variant="primary"
            className="h-14 flex-1 text-lg"
            onClick={generate}
            loading={submitting}
            disabled={!!built?.blocked.length || !workflow}
          >
            {pending.length ? `Generate (${pending.length} running)` : env?.mock ? 'Generate (MOCK)' : 'Generate'}
          </Button>
        </div>
      </div>
    </div>
  );
}
