'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fileUrl, useApi } from '@/lib/client/api';
import { Draft, useDraft } from '@/lib/client/draft';
import { promptAdvice } from '@/lib/prompt-advice';
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
import { OutfitReference } from './OutfitReference';
import { PoseCheck } from './PoseCheck';
import { detectFramingConflicts, FramingLevel } from '@/lib/framing';
import { Badge, Button, Card, Chip, Collapsible, Notice, PageHeader, SectionTitle, Select, Slider, Spinner, TextArea, Toggle, cx, toast } from './ui';

interface SettingsPayload {
  settings: AppSettings;
  env: { adultContentAllowed: boolean; mock: boolean; effectiveComfyUrl: string; experiments?: boolean };
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
  avoid: 'e.g. wide bikini cups, thick straps, beige fabric (no need to write “no”)',
};

/** Fields always shown; the rest sit under "More details". */
const MAIN_KEYS: (keyof PromptFields)[] = ['outfit', 'avoid', 'pose', 'setting', 'lighting', 'expression'];
const MORE_KEYS: (keyof PromptFields)[] = ['bodyPresentation', 'framing', 'camera', 'realism', 'extra'];

/** Number of Phase 1 quality options switched on (for the section badge). */
function phase1On(p: Draft['params'], experiments: boolean): number {
  return [!!p.hires, experiments && (p.poseRetarget ?? 0) > 0, experiments && !!p.promptCleanup, experiments && p.outfitIsolation === 'garment'].filter(Boolean)
    .length;
}

/** About one megapixel at the given aspect ratio, in multiples of 64 (SDXL-friendly). */
function sizeForAspect(aspect: number) {
  const area = 832 * 1216;
  const r64 = (n: number) => Math.min(1536, Math.max(512, Math.round(n / 64) * 64));
  return { width: r64(Math.sqrt(area * aspect)), height: r64(Math.sqrt(area / aspect)) };
}

/** A titled block inside a card, for settings that belong to one photo. */
function SubPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl bg-ink-950/60 p-3 ring-1 ring-ink-800">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{title}</p>
      {children}
    </div>
  );
}


export function CreateScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const { draft, setDraft, isNew, droppedPhotos } = useDraft();
  useEffect(() => {
    if (droppedPhotos) toast(`${droppedPhotos === 1 ? 'A photo on this screen was' : `${droppedPhotos} photos on this screen were`} lost when the app restarted — add again if needed.`, 'error');
  }, [droppedPhotos]);

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
            images: {
              initImage: rec.initImage,
              poseImage: rec.poseImage,
              faceReferenceId: rec.faceReference?.id ?? null,
              outfitImage: rec.outfitReference?.image ?? null,
            },
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
  // Shot size implied by the pose photo's skeleton (from "Check pose"); feeds the framing check.
  const [poseExtent, setPoseExtent] = useState<FramingLevel | null>(null);
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

  const advice = useMemo(
    () => (built && draft ? promptAdvice({ positive: built.positive, outfit: built.effectiveFields.outfit, avoid: draft.fields.avoid }) : []),
    [built, draft],
  );

  const update = useCallback((fn: (d: Draft) => Draft) => setDraft(fn), [setDraft]);
  const framingIssues = useMemo(
    () => (draft ? detectFramingConflicts(draft.fields, draft.images.poseImage ? poseExtent : null) : []),
    [draft, poseExtent],
  );
  const onGarmentImage = useCallback(
    (img: GenerationRecord['initImage']) => setDraft((d) => ({ ...d, images: { ...d.images, outfitGarmentImage: img } })),
    [setDraft],
  );
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
  // The saved copy of the production workflow predates the outfit nodes (fixed by Reset in Library).
  const outfitNeedsReset = !caps.outfit && workflow?.id === 'sienna-sdxl-production';
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

      {/* ── Sienna ── */}
      <Card className={cx('mt-3 space-y-3', draft.siennaLock && 'ring-accent/60')}>
        <Toggle
          checked={draft.siennaLock}
          onChange={(v) => update((d) => ({ ...d, siennaLock: v }))}
          label={<span className="font-semibold">🔒 Sienna Lock</span>}
          description={draft.siennaLock ? 'Keeps her face, hair and look consistent.' : 'Off — free prompt, nothing about Sienna is added.'}
        />
        {draft.siennaLock && (
          <Select
            label="Sienna model"
            value={draft.params.siennaModel ?? ''}
            onChange={(v) => setParam('siennaModel', v)}
            options={[
              { value: '', label: `Default (${character.loraFilename || 'not set'})` },
              ...SIENNA_MODELS.filter((m) => m.file !== character.loraFilename).map((m) => ({ value: m.file, label: m.label })),
            ]}
            hint={
              abModel ? (
                <span className="text-amber-400">{abModel.note}</span>
              ) : (
                <span>
                  {lockedLora || 'No LoRA set'} @ {draft.params.loraStrength} ·{' '}
                  <Link href="/character" className="text-accent">
                    Edit profile
                  </Link>
                </span>
              )
            }
          />
        )}
        <div className="grid grid-cols-2 gap-2">
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

      {/* ── Describe ── */}
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
        Describe the photo
      </SectionTitle>
      <Card className="space-y-4">
        {MAIN_KEYS.map((k) => (
          <TextArea
            key={k}
            label={PROMPT_FIELD_LABELS[k]}
            value={draft.fields[k] ?? ''}
            placeholder={PLACEHOLDERS[k]}
            onChange={(e) => setField(k, e.target.value)}
            warning={fieldWarning(k)}
          />
        ))}
        <details className="group" open={MORE_KEYS.some((k) => draft.fields[k])}>
          <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between text-sm text-ink-200">
            <span>
              More details <span className="text-ink-400">— body, camera, framing, realism</span>
            </span>
            <span className="text-ink-400 transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="mt-3 space-y-4">
            {MORE_KEYS.map((k) => (
              <TextArea
                key={k}
                label={PROMPT_FIELD_LABELS[k]}
                value={draft.fields[k]}
                placeholder={k === 'camera' && draft.siennaLock ? character.defaultCameraStyle : PLACEHOLDERS[k]}
                onChange={(e) => setField(k, e.target.value)}
                warning={fieldWarning(k)}
              />
            ))}
          </div>
        </details>
        {framingIssues.length > 0 && (
          <div className="space-y-2">
            {framingIssues.map((issue, i) => (
              <Notice key={i} kind={issue.severity === 'warn' ? 'warn' : 'info'}>
                {issue.message}
                {issue.suggestion && (
                  <button
                    className="ml-2 underline"
                    onClick={() => setField(issue.suggestion!.field, issue.suggestion!.value)}
                  >
                    {issue.suggestion.label}
                  </button>
                )}
              </Notice>
            ))}
          </div>
        )}
        {advice.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-ink-400">Outfit control</p>
            {advice.map((a) => (
              <Notice key={a.id} kind="warn">
                {a.text}
              </Notice>
            ))}
          </div>
        )}
      </Card>

      {/* ── Copy from a photo ── */}
      <SectionTitle right={<span className="text-xs text-ink-400">optional</span>}>Copy from a photo</SectionTitle>
      <Card className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <ImagePicker
            label="Outfit"
            aspect="aspect-[3/4]"
            value={draft.images.outfitImage ?? null}
            onChange={(img) => update((d) => ({ ...d, images: { ...d.images, outfitImage: img } }))}
            disabled={!caps.outfit}
            hint={caps.outfit ? undefined : outfitNeedsReset ? 'Reset the workflow in Library first' : 'Not in this workflow'}
          />
          <ImagePicker
            label="Pose"
            aspect="aspect-[3/4]"
            value={draft.images.poseImage}
            onChange={(img) => update((d) => ({ ...d, images: { ...d.images, poseImage: img } }))}
            disabled={!caps.pose}
            hint={caps.pose ? undefined : 'Not in this workflow'}
          />
          <ImagePicker
            label="Start image"
            aspect="aspect-[3/4]"
            value={draft.images.initImage}
            onChange={(img) =>
              update((d) => ({
                ...d,
                images: { ...d.images, initImage: img },
                // A start image at full denoise would be ignored — begin halfway.
                params: img && d.params.denoise >= 0.95 ? { ...d.params, denoise: 0.55 } : d.params,
              }))
            }
            disabled={!caps.img2img}
            hint={caps.img2img ? undefined : 'Not in this workflow'}
          />
        </div>
        {!draft.images.outfitImage && !draft.images.poseImage && !draft.images.initImage && (
          <p className="text-xs text-ink-400">
            <b className="text-ink-200">Outfit</b> copies the clothes. <b className="text-ink-200">Pose</b> copies only the body position (a stick-figure
            skeleton — never the face or body). <b className="text-ink-200">Start image</b> reworks an existing picture.
          </p>
        )}

        {draft.images.outfitImage && caps.outfit && (
          <SubPanel title="Outfit">
            <OutfitReference
              enabled={caps.outfit}
              image={draft.images.outfitImage ?? null}
              strength={draft.params.outfitStrength ?? DEFAULT_PARAMS.outfitStrength!}
              onStrength={(v) => setParam('outfitStrength', v)}
              outfitText={draft.fields.outfit}
              onUseText={(t) => setField('outfit', t)}
              isolation={env?.experiments ? draft.params.outfitIsolation ?? 'person' : 'person'}
              garmentImage={draft.images.outfitGarmentImage ?? null}
              onGarmentImage={onGarmentImage}
            />
          </SubPanel>
        )}
        {draft.images.poseImage && caps.pose && (
          <SubPanel title="Pose">
            <p className="text-xs text-ink-400">Only the body position is copied — Sienna keeps her own face and body. Your Pose text is still used.</p>
            <Slider label="Pose strength" hint="lower = looser" value={draft.params.controlStrength} min={0} max={1.5} step={0.05} onChange={(v) => setParam('controlStrength', v)} />
            <PoseCheck
              image={draft.images.poseImage}
              width={draft.params.width}
              height={draft.params.height}
              fit={draft.params.poseFit ?? 'pad'}
              retarget={env?.experiments ? draft.params.poseRetarget ?? 0 : 0}
              onExtent={setPoseExtent}
            />
            {draft.images.poseImage.width && draft.images.poseImage.height && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  const size = sizeForAspect(draft.images.poseImage!.width! / draft.images.poseImage!.height!);
                  update((d) => ({ ...d, params: { ...d.params, ...size } }));
                  toast(`Output size set to ${size.width}×${size.height} to match the pose photo`);
                }}
              >
                Match output size to the pose photo
              </Button>
            )}
          </SubPanel>
        )}
        {draft.images.initImage && caps.img2img && (
          <SubPanel title="Start image">
            <Slider
              label="How much to change"
              hint="lower = closer to the start image"
              value={draft.params.denoise}
              min={0.05}
              max={1}
              step={0.01}
              onChange={(v) => setParam('denoise', v)}
            />
          </SubPanel>
        )}

        {refs.length > 0 && caps.faceReference && (
          <SubPanel title="Face reference">
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
            <Slider label="Face reference weight" value={draft.params.faceStrength} min={0} max={1.5} step={0.05} onChange={(v) => setParam('faceStrength', v)} />
          </SubPanel>
        )}
      </Card>

      {/* ── Settings ── */}
      <SectionTitle>Settings</SectionTitle>
      <div className="space-y-3">
        <Collapsible title="Size, quality & seed">
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
          </div>
          <Slider label="Images per run" value={draft.params.batchSize} min={1} max={4} step={1} onChange={(v) => setParam('batchSize', v)} />
          {caps.faceRefine && (
            <>
              <Toggle
                checked={draft.params.faceRefine ?? DEFAULT_PARAMS.faceRefine}
                onChange={(v) => setParam('faceRefine', v)}
                label="Face refinement for small faces"
                description={`Redraws Sienna’s face when it is under ${draft.params.faceRefineThreshold ?? DEFAULT_PARAMS.faceRefineThreshold}px (full-body, mirror shots).`}
              />
              {(draft.params.faceRefine ?? DEFAULT_PARAMS.faceRefine) && (
                <Slider
                  label="Face refinement strength"
                  hint="lower keeps expression and lighting"
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
        </Collapsible>

        <Collapsible
          title="Quality"
          badge={phase1On(draft.params, !!env?.experiments) ? <Badge tone="accent">{phase1On(draft.params, !!env?.experiments)} on</Badge> : null}
        >
          <Select
            label="Pose photo shape"
            value={draft.params.poseFit ?? 'pad'}
            onChange={(v) => setParam('poseFit', v === 'crop' ? 'crop' : 'pad')}
            options={[
              { value: 'pad', label: 'Keep the whole pose photo (recommended)' },
              { value: 'crop', label: 'Crop to the output shape (previous)' },
            ]}
            hint="Only matters with a pose photo. Keeping the whole photo stops heads and feet being cut off."
          />
          {env?.experiments && (
            <Slider
              label="Pose retargeting"
              hint="0 = off · rescales the skeleton toward Sienna's proportions, angles kept"
              value={draft.params.poseRetarget ?? 0}
              min={0}
              max={1}
              step={0.25}
              onChange={(v) => setParam('poseRetarget', v)}
            />
          )}
          <Toggle
            checked={draft.params.hires ?? false}
            onChange={(v) => setParam('hires', v)}
            label="Refinement pass"
            description="Upscales 1.5× and re-renders lightly for sharper eyes, hair and fabric. About 1.5× slower."
          />
          {draft.params.hires && (
            <>
              <Slider label="Refinement scale" value={draft.params.hiresScale ?? 1.5} min={1.25} max={2} step={0.05} onChange={(v) => setParam('hiresScale', v)} />
              <Slider label="Refinement strength" hint="denoise · higher changes more" value={draft.params.hiresDenoise ?? 0.3} min={0.15} max={0.5} step={0.05} onChange={(v) => setParam('hiresDenoise', v)} />
              <Slider label="Refinement LoRA strength" hint="lower lets photographic texture through" value={draft.params.hiresLoraStrength ?? 0.7} min={0.3} max={1.2} step={0.05} onChange={(v) => setParam('hiresLoraStrength', v)} />
            </>
          )}
          {env?.experiments && (
            <>
              <Toggle
                checked={draft.params.promptCleanup ?? false}
                onChange={(v) => setParam('promptCleanup', v)}
                label="Prompt cleanup"
                description="Drops negatives that fight natural skin (wrinkles, aged skin) and abstract identity phrases."
              />
              <Select
                label="Outfit isolation"
                value={draft.params.outfitIsolation ?? 'person'}
                onChange={(v) => setParam('outfitIsolation', v === 'garment' ? 'garment' : 'person')}
                options={[
                  { value: 'person', label: 'Whole person minus face (current)' },
                  { value: 'garment', label: 'Garment only, flat silhouette for fit' },
                ]}
                hint="Garment only needs “Analyze outfit” to be run on the outfit photo."
              />
            </>
          )}
        </Collapsible>

        <Collapsible title="Expert">
          <Select
            label="Workflow"
            value={workflowId}
            onChange={(v) => update((d) => ({ ...d, workflowId: v || null }))}
            options={workflows.map((w) => ({ value: w.id, label: w.name }))}
          />
          {caps.checkpoint && (
            <Select
              label="Base model"
              value={draft.params.checkpoint}
              onChange={(v) => setParam('checkpoint', v)}
              placeholder="(workflow default)"
              options={(opts.checkpoint ?? []).map((o) => ({ value: o, label: o }))}
            />
          )}
          {!draft.siennaLock && (
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
          <div className="grid grid-cols-2 gap-2">
            <Slider label="Width" value={draft.params.width} min={512} max={1536} step={64} onChange={(v) => setParam('width', v)} />
            <Slider label="Height" value={draft.params.height} min={512} max={1536} step={64} onChange={(v) => setParam('height', v)} />
          </div>
          <Slider label="Steps" value={draft.params.steps} min={4} max={80} step={1} onChange={(v) => setParam('steps', v)} />
          <Slider label={caps.guidance ? 'Guidance (Flux)' : 'CFG'} value={draft.params.cfg} min={1} max={12} step={0.1} onChange={(v) => setParam('cfg', v)} />
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
              label="Pose ControlNet model"
              value={draft.params.controlnetModel}
              onChange={(v) => setParam('controlnetModel', v)}
              placeholder="(workflow default)"
              options={(opts.controlnet_model ?? []).map((o) => ({ value: o, label: o }))}
            />
          )}
          {optionsQ.data?.error && <Notice kind="warn">Couldn’t load model lists: {optionsQ.data.error}</Notice>}
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => update((d) => ({ ...d, params: { ...DEFAULT_PARAMS, ...settings.defaultParams, loraStrength: character.loraWeight, loraClipStrength: character.loraClipWeight } }))}
          >
            Reset all settings to defaults
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
              {draft.images.outfitImage &&
                (caps.outfit ? (
                  <Notice kind="info">
                    Outfit photo on — strength {Math.min(draft.params.outfitStrength ?? DEFAULT_PARAMS.outfitStrength!, 1).toFixed(2)}. Clothing only; Sienna&apos;s
                    LoRA, face refinement and identity settings are unchanged.
                  </Notice>
                ) : (
                  <Notice kind="error">This workflow has no outfit input — generation will be refused. Pick Sienna Production · SDXL.</Notice>
                ))}
              {draft.images.poseImage && caps.pose && (
                <Notice kind="info">Pose photo on — strength {draft.params.controlStrength}. Only the skeleton (body position) is used.</Notice>
              )}
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
