'use client';

import { useEffect, useState } from 'react';
import { api, fileUrl, useApi } from '@/lib/client/api';
import { DEFAULT_NEGATIVE_PROMPT, DEFAULT_REALISM_PROMPT, MIN_CHARACTER_AGE } from '@/lib/defaults';
import type { CharacterProfile, StoredImage } from '@/lib/types';
import { ImagePicker } from './ImagePicker';
import { Button, Card, Notice, SectionTitle, Select, Slider, TextArea, TextInput, cx, toast } from './ui';

/** Editable Sienna identity profile. Used by the Sienna tab and the setup wizard. */
export function CharacterEditor({
  sections = ['identity', 'lora', 'refs', 'prompts'],
  onSaved,
  saveLabel = 'Save profile',
}: {
  sections?: ('identity' | 'lora' | 'refs' | 'prompts')[];
  onSaved?: (c: CharacterProfile) => void;
  saveLabel?: string;
}) {
  const { data, setData } = useApi<CharacterProfile>('/api/character');
  const options = useApi<{ options: Record<string, string[]>; error: string | null }>(sections.includes('lora') ? '/api/comfy/options' : null);
  const [c, setC] = useState<CharacterProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [manualLora, setManualLora] = useState(false);

  useEffect(() => {
    if (data && !c) setC(data);
  }, [data, c]);

  if (!c) return null;
  const set = <K extends keyof CharacterProfile>(k: K, v: CharacterProfile[K]) => setC({ ...c, [k]: v });
  const loras = options.data?.options.lora_name ?? [];

  async function save() {
    if (!c) return;
    setSaving(true);
    try {
      const { updatedAt, ...body } = c;
      const saved = await api<CharacterProfile>('/api/character', { method: 'PUT', json: body });
      setData(saved);
      setC(saved);
      toast('Profile saved');
      onSaved?.(saved);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function addSecondary(img: StoredImage | null) {
    if (img) set('secondaryReferences', [...c!.secondaryReferences, img]);
  }

  return (
    <div className="space-y-3">
      {sections.includes('identity') && (
        <>
          <SectionTitle>Identity</SectionTitle>
          <Card className="space-y-4">
            <div className="grid grid-cols-[1fr,96px] gap-3">
              <TextInput label="Name" value={c.name} onChange={(e) => set('name', e.target.value)} />
              <TextInput
                label="Age"
                inputMode="numeric"
                value={String(c.age)}
                onChange={(e) => set('age', Number(e.target.value.replace(/\D/g, '')) || 0)}
                hint={`≥${MIN_CHARACTER_AGE}`}
              />
            </div>
            {c.age < MIN_CHARACTER_AGE && <Notice kind="error">Sienna must be an adult — age {MIN_CHARACTER_AGE} or older.</Notice>}
            <TextInput
              label="Trigger token"
              hint="the word your LoRA was trained on"
              value={c.triggerToken}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => set('triggerToken', e.target.value)}
            />
            <TextArea
              label="Core appearance traits"
              hint="locked by Sienna Lock"
              rows={4}
              value={c.appearanceTraits}
              onChange={(e) => set('appearanceTraits', e.target.value)}
            />
            <TextInput
              label="Extra locked terms"
              hint="comma-separated words Sienna Lock should always strip"
              value={c.extraLockedTerms.join(', ')}
              onChange={(e) =>
                set(
                  'extraLockedTerms',
                  e.target.value.split(',').map((s) => s.trimStart()),
                )
              }
            />
          </Card>
        </>
      )}

      {sections.includes('lora') && (
        <>
          <SectionTitle>Sienna LoRA</SectionTitle>
          <Card className="space-y-4">
            {!manualLora && loras.length > 0 ? (
              <Select
                label="LoRA file on ComfyUI"
                value={c.loraFilename}
                onChange={(v) => set('loraFilename', v)}
                placeholder="(none — prompt + face reference only)"
                options={loras.map((l) => ({ value: l, label: l }))}
              />
            ) : (
              <TextInput
                label="LoRA filename"
                hint="exactly as in ComfyUI/models/loras"
                placeholder="sienna_v1.safetensors"
                autoCapitalize="off"
                autoCorrect="off"
                value={c.loraFilename}
                onChange={(e) => set('loraFilename', e.target.value)}
              />
            )}
            <button className="text-xs text-accent" onClick={() => setManualLora(!manualLora)}>
              {manualLora || loras.length === 0 ? 'Pick from server list' : 'Type filename manually'}
            </button>
            {options.data?.error && <Notice kind="warn">Couldn’t list LoRAs: {options.data.error}</Notice>}
            <Slider label="Default LoRA strength" value={c.loraWeight} min={0} max={1.5} step={0.05} onChange={(v) => set('loraWeight', v)} />
            <Slider label="Default LoRA CLIP strength" value={c.loraClipWeight} min={0} max={1.5} step={0.05} onChange={(v) => set('loraClipWeight', v)} />
          </Card>
        </>
      )}

      {sections.includes('refs') && (
        <>
          <SectionTitle>Reference images</SectionTitle>
          <Card className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <ImagePicker
                label="Preferred face reference"
                purpose="ref"
                value={c.faceReference}
                onChange={(img) => set('faceReference', img)}
                hint="Clear, front-facing, neutral light"
              />
              <div className="text-xs text-ink-400">
                <p className="mb-2 text-sm text-ink-200">Tips</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>Use a render of Sienna herself (e.g. a Studio-neutral output).</li>
                  <li>Face fills ~60% of the frame, no sunglasses or heavy shadow.</li>
                  <li>Add 2–5 secondary angles for variety.</li>
                </ul>
              </div>
            </div>
            <div>
              <p className="mb-1 text-sm text-ink-200">Secondary references</p>
              <div className="grid grid-cols-3 gap-2">
                {c.secondaryReferences.map((img) => (
                  <div key={img.id} className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrl(img.file)} alt="" className="aspect-[3/4] w-full rounded-lg object-cover" />
                    <div className="flex gap-1">
                      <button
                        className="h-9 flex-1 rounded-lg bg-ink-800 text-[11px]"
                        onClick={() =>
                          setC({
                            ...c,
                            faceReference: img,
                            secondaryReferences: [...c.secondaryReferences.filter((x) => x.id !== img.id), ...(c.faceReference ? [c.faceReference] : [])],
                          })
                        }
                      >
                        Primary
                      </button>
                      <button
                        className="h-9 w-9 rounded-lg bg-ink-800 text-[11px]"
                        aria-label="Remove"
                        onClick={() => set('secondaryReferences', c.secondaryReferences.filter((x) => x.id !== img.id))}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <ImagePicker label="" purpose="ref" value={null} onChange={addSecondary} />
              </div>
            </div>
            <label className={cx('flex items-start gap-3 rounded-xl p-3 ring-1', c.fictionalAttestation ? 'ring-ink-700' : 'ring-amber-700')}>
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-[#e8836b]"
                checked={c.fictionalAttestation}
                onChange={(e) => set('fictionalAttestation', e.target.checked)}
              />
              <span className="text-sm">
                I confirm these reference images depict the fictional adult character {c.name || 'Sienna'} (e.g. AI-generated), not a photo of a real person.
              </span>
            </label>
          </Card>
        </>
      )}

      {sections.includes('prompts') && (
        <>
          <SectionTitle>Default prompts</SectionTitle>
          <Card className="space-y-4">
            <TextArea label="Default camera style" rows={2} value={c.defaultCameraStyle} onChange={(e) => set('defaultCameraStyle', e.target.value)} />
            <TextArea label="Default realism prompt" rows={5} value={c.defaultRealismPrompt} onChange={(e) => set('defaultRealismPrompt', e.target.value)} />
            <Button variant="ghost" className="w-full" onClick={() => set('defaultRealismPrompt', DEFAULT_REALISM_PROMPT)}>
              Restore realism default
            </Button>
            <TextArea label="Default negative prompt" rows={5} value={c.defaultNegativePrompt} onChange={(e) => set('defaultNegativePrompt', e.target.value)} />
            <Button variant="ghost" className="w-full" onClick={() => set('defaultNegativePrompt', DEFAULT_NEGATIVE_PROMPT)}>
              Restore negative default
            </Button>
          </Card>
        </>
      )}

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+72px)] z-10 pt-2">
        <Button
          variant="primary"
          className="h-12 w-full shadow-lg"
          loading={saving}
          disabled={c.age < MIN_CHARACTER_AGE || (sections.includes('refs') && !!c.faceReference && !c.fictionalAttestation)}
          onClick={save}
        >
          {saveLabel}
        </Button>
        {sections.includes('refs') && c.faceReference && !c.fictionalAttestation && (
          <p className="mt-1 text-center text-xs text-amber-300">Confirm the reference images are of the fictional character to save.</p>
        )}
      </div>
    </div>
  );
}
