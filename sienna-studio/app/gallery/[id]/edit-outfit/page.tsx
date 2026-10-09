'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fileUrl, useApi } from '@/lib/client/api';
import { cropTopAndUpload, OutfitEditAvailability, startOutfitEdit } from '@/lib/client/outfit-edit';
import { runJob } from '@/lib/client/poll';
import {
  BodyProtect,
  buildEditPrompt,
  NO_PROTECT,
  PROTECT_LABELS,
  defaultFootwear,
  FACE_LABELS,
  FOOTWEAR_LABELS,
  MAX_DESCRIPTION,
  OutfitEditFace,
  OutfitEditFootwear,
  OutfitEditScope,
  SCOPE_LABELS,
} from '@/lib/outfit-edit';
import type { OutfitAnalysis } from '@/lib/outfit';
import type { GenerationRecord, StoredImage } from '@/lib/types';
import { ImagePicker } from '@/components/ImagePicker';
import { Badge, Button, Card, Chip, Collapsible, Notice, PageHeader, SectionTitle, Slider, Spinner, TextArea, TextInput, Toggle, toast } from '@/components/ui';

type AnalyzeStatus = { state: 'pending' | 'running' } | { state: 'error'; error: string } | ({ state: 'done' } & OutfitAnalysis);

const DESCRIPTION_HINT: Record<OutfitEditScope, string> = {
  full: 'Every piece in the photo: colours, top and bottom construction, straps and ties, neckline, cut, length.',
  top: 'Only the top in the photo: colour, construction, straps and ties, neckline, length.',
  bottom: 'Only the bottom in the photo: colour, construction, rise, ties, leg line, length.',
};

export default function EditOutfitPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const imageIndex = Math.max(0, Number(search.get('image') ?? 0) || 0);
  const router = useRouter();
  const { data: rec, error } = useApi<GenerationRecord>(`/api/history/${id}`);
  const { data: avail } = useApi<OutfitEditAvailability>('/api/outfit-edit');

  const [reference, setReference] = useState<StoredImage | null>(null);
  const [manualCrop, setManualCrop] = useState(false);
  const [cut, setCut] = useState(0.2);
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<OutfitEditScope>('full');
  const [footwear, setFootwear] = useState<OutfitEditFootwear>('keep');
  const [footwearTouched, setFootwearTouched] = useState(false);
  const [face, setFace] = useState<OutfitEditFace>('standard');
  const [seed, setSeed] = useState('');
  const [protect, setProtect] = useState<BodyProtect>(NO_PROTECT);
  const [analysis, setAnalysis] = useState<AnalyzeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => () => void (cancelled.current = true), []);

  // Footwear follows the description (barefoot for whole-outfit swimwear) until the user picks one.
  useEffect(() => {
    if (!footwearTouched) setFootwear(defaultFootwear(scope, description));
  }, [scope, description, footwearTouched]);
  // A new photo invalidates the previous description analysis.
  useEffect(() => setAnalysis(null), [reference?.id]);

  const source = rec?.images[imageIndex] ?? null;
  const originalOutfit = rec?.fields.outfit ?? '';
  const prompt = useMemo(
    () => buildEditPrompt({ scope, description: description || '…', originalOutfit, footwear, protect }),
    [scope, description, originalOutfit, footwear, protect],
  );

  if (error) return <p className="pt-20 text-center text-red-300">{error}</p>;
  if (!rec || !avail)
    return (
      <div className="flex justify-center pt-24">
        <Spinner />
      </div>
    );

  async function describe() {
    if (!reference) return;
    setAnalysis({ state: 'pending' });
    try {
      const s = await runJob<AnalyzeStatus>('/api/outfit/analyze', { image: reference }, setAnalysis, () => cancelled.current);
      if (s?.state === 'done' && s.outfitText) setDescription(s.outfitText.slice(0, MAX_DESCRIPTION));
    } catch (e: any) {
      setAnalysis({ state: 'error', error: e.message });
    }
  }

  async function run() {
    if (!reference || !source) return;
    setBusy(true);
    try {
      const ref = manualCrop ? await cropTopAndUpload(reference, cut) : reference;
      const next = await startOutfitEdit({
        sourceId: rec!.id,
        imageIndex,
        reference: ref,
        manualCrop,
        description,
        scope,
        footwear,
        face,
        seed: seed.trim() === '' ? -1 : Math.max(0, Math.floor(Number(seed)) || 0),
        ...(avail?.experiments ? { protect } : {}),
      });
      toast(next.status === 'error' ? 'Edit failed — see details' : 'Edit queued');
      router.push(`/gallery/${next.id}`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const canRun = avail.enabled && avail.available && !!source && !!reference && description.trim().length >= 3;
  const swimTopOnly = scope !== 'full' && /\bbikini\b/i.test(description) && !/\b(top|bottoms?|briefs)\b/i.test(description);

  return (
    <div className="pb-nav">
      <PageHeader
        title="Edit outfit"
        subtitle="Change the clothes on this image"
        right={
          <button onClick={() => router.back()} className="min-h-[44px] px-2 text-accent">
            Cancel
          </button>
        }
      />

      {!avail.enabled && <Notice kind="warn">Edit Outfit is turned off on this server (set SIENNA_OUTFIT_EDIT=true to enable it).</Notice>}
      {avail.enabled && !avail.available && (
        <Notice kind="error">
          <p className="font-medium">The GPU server isn’t set up for Edit Outfit yet</p>
          <ul className="mt-1 list-disc pl-4">
            {avail.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">Run comfyui-bootstrap.sh --with-qwen-edit on a 24 GB+ GPU (~30 GB of models).</p>
        </Notice>
      )}
      {avail.backend === 'mock' && <Notice kind="warn">Mock mode — the result will be a placeholder image, not a real edit.</Notice>}

      {/* Source */}
      <div className="mt-3 flex gap-3">
        {source && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl(source.file)} alt="Image to edit" className="h-40 w-[120px] shrink-0 rounded-xl bg-black object-cover" />
        )}
        <div className="min-w-0 text-sm">
          <p className="text-ink-400">Now wearing</p>
          <p className="line-clamp-4">{originalOutfit || <span className="text-ink-400">(no outfit text)</span>}</p>
          <p className="mt-2 text-xs text-emerald-300">The original stays as it is — the edit is saved as a new image.</p>
        </div>
      </div>

      {/* Clothing photo */}
      <SectionTitle>Clothing photo</SectionTitle>
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <ImagePicker label="Clothing reference" value={reference} onChange={setReference} hint="A photo showing the whole garment." />
          <div>
            <p className="mb-1 text-sm text-ink-200">What the editor sees</p>
            <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-ink-800 ring-1 ring-ink-700">
              {reference ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(reference.file)} alt="" className="h-full w-full object-contain" />
                  {manualCrop ? (
                    <div className="absolute inset-x-0 top-0 border-b-2 border-accent bg-black/70" style={{ height: `${cut * 100}%` }}>
                      <span className="absolute bottom-1 left-1 text-[10px] text-accent">removed</span>
                    </div>
                  ) : (
                    <span className="absolute inset-x-1 top-1 rounded bg-black/70 px-1 text-center text-[10px] text-ink-200">
                      Above the chin is removed automatically
                    </span>
                  )}
                </>
              ) : (
                <span className="flex h-full items-center justify-center px-2 text-center text-xs text-ink-400">Add a photo first</span>
              )}
            </div>
          </div>
        </div>
        <p className="text-xs text-ink-400">
          The photo is cropped just below the chin so the editor can’t copy that person’s face; the whole garment (neck ties included) is kept.
        </p>
        <Toggle checked={manualCrop} onChange={setManualCrop} label="Crop by hand" description="Use if the automatic crop misses the face (e.g. a seated or close-up photo)." />
        {manualCrop && <Slider label="Remove from the top" value={cut} onChange={setCut} min={0} max={0.7} step={0.01} hint="fraction of the height" />}
      </Card>

      {/* What to change */}
      <SectionTitle>What to change</SectionTitle>
      <Card className="space-y-4">
        <div>
          <p className="mb-2 text-sm text-ink-200">Replace</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SCOPE_LABELS) as OutfitEditScope[]).map((s) => (
              <Chip key={s} active={scope === s} onClick={() => setScope(s)}>
                {SCOPE_LABELS[s]}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <TextArea
            label="Clothing description"
            hint={`${description.length}/${MAX_DESCRIPTION}`}
            rows={4}
            maxLength={MAX_DESCRIPTION}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. a black two-piece bikini: a strapless bandeau top with thin gold trim, and low-rise bottoms with string ties at both hips"
            warning={swimTopOnly ? `You chose “${SCOPE_LABELS[scope]}” — describe only that piece (e.g. “bikini top”).` : undefined}
          />
          <p className="mt-1 text-xs text-ink-400">{DESCRIPTION_HINT[scope]}</p>
          <Notice kind="info">
            The editor follows this text over the photo. A detail that isn’t in the photo (a cut-out, another colour) will be added — check it matches.
          </Notice>
          <Button className="mt-2 w-full" disabled={!reference || analysis?.state === 'pending' || analysis?.state === 'running'} onClick={describe}>
            {analysis?.state === 'pending' || analysis?.state === 'running' ? (
              <>
                <Spinner /> Describing the photo…
              </>
            ) : (
              'Describe from photo'
            )}
          </Button>
          {analysis?.state === 'error' && <p className="mt-1 text-xs text-red-300">{analysis.error}</p>}
          {analysis?.state === 'done' && (
            <p className="mt-1 text-xs text-amber-300">Draft from the photo — edit it: automatic descriptions miss straps, ties and exact cuts.</p>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm text-ink-200">Footwear</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FOOTWEAR_LABELS) as OutfitEditFootwear[]).map((f) => (
              <Chip
                key={f}
                active={footwear === f}
                onClick={() => {
                  setFootwear(f);
                  setFootwearTouched(true);
                }}
              >
                {FOOTWEAR_LABELS[f]}
              </Chip>
            ))}
          </div>
          {footwear !== 'reference' && <p className="mt-1 text-xs text-ink-400">Shoes in the clothing photo can still be copied — if they are, crop them off by hand.</p>}
        </div>
        <div>
          <p className="mb-2 text-sm text-ink-200">Sienna face restore</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FACE_LABELS) as OutfitEditFace[]).map((f) => (
              <Chip key={f} active={face === f} onClick={() => setFace(f)}>
                {FACE_LABELS[f]}
              </Chip>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-400">
            Redraws the face with Sienna’s FaceDetailer after the edit. Use Strong for distant or angled faces.
          </p>
        </div>
      </Card>

      {avail.experiments && (
        <div className="mt-3">
          <Collapsible title="Body protection · experimental" defaultOpen badge={Object.values(protect).some(Boolean) ? <Badge tone="accent">on</Badge> : null}>
            <p className="text-xs text-ink-400">
              Keeps Sienna’s trained body instead of the clothing model’s. Not yet proven on the GPU — compare results with and without.
            </p>
            {(['bodyRef', 'garmentOnly', 'bodyCheck'] as (keyof BodyProtect)[]).map((k) => {
              const missing = avail.protectMissing?.[k] ?? [];
              const blocked = missing.length > 0 || (k === 'garmentOnly' && manualCrop);
              return (
                <div key={k}>
                  <Toggle
                    checked={protect[k] && !blocked}
                    disabled={blocked}
                    onChange={(v) => setProtect((p) => ({ ...p, [k]: v }))}
                    label={PROTECT_LABELS[k].label + (k === 'bodyRef' ? ` (${avail.bodyRefCount} approved)` : '')}
                    description={PROTECT_LABELS[k].description}
                  />
                  {missing.length > 0 && (
                    <p className="text-xs text-amber-300">
                      Needs: {missing.join('; ')}
                      {k === 'bodyRef' && (
                        <>
                          {' '}
                          — <Link href="/character" className="underline">Sienna page</Link>
                        </>
                      )}
                    </p>
                  )}
                  {k === 'garmentOnly' && manualCrop && <p className="text-xs text-ink-400">Off while cropping by hand (it needs the face to learn the skin colour).</p>}
                </div>
              );
            })}
          </Collapsible>
        </div>
      )}

      <div className="mt-3 space-y-3">
        <Collapsible title="Advanced">
          <TextInput label="Seed" inputMode="numeric" placeholder="random" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} />
          <div>
            <p className="mb-1 text-sm text-ink-200">Instruction sent to the editor</p>
            <p className="select-text whitespace-pre-wrap rounded-xl bg-ink-800 p-3 text-xs text-ink-200">{prompt}</p>
          </div>
        </Collapsible>
      </div>

      <Button variant="primary" className="mt-4 w-full" disabled={!canRun} loading={busy} onClick={run}>
        Edit outfit
      </Button>
      <p className="mt-2 text-center text-xs text-ink-400">
        {!reference ? 'Add a clothing photo to continue.' : description.trim().length < 3 ? 'Describe the clothing to continue.' : 'About 2 minutes on an L40S-class GPU (7–8 minutes on an RTX 3090).'}
      </p>
      <Link href={`/gallery/${rec.id}`} className="mt-3 block text-center text-sm text-accent">
        ← Back to the image
      </Link>
    </div>
  );
}
