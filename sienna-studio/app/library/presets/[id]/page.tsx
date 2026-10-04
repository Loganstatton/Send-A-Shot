'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/client/api';
import { EMPTY_FIELDS, SIZE_PRESETS } from '@/lib/defaults';
import type { Preset, PromptFields, WorkflowTemplate } from '@/lib/types';
import { PROMPT_FIELD_KEYS, PROMPT_FIELD_LABELS } from '@/lib/types';
import { Button, Card, Chip, PageHeader, SectionTitle, Select, Slider, Spinner, TextArea, TextInput, toast } from '@/components/ui';

type Editable = Pick<Preset, 'name' | 'emoji' | 'fields' | 'params' | 'workflowId'>;

export default function PresetEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const router = useRouter();
  const presets = useApi<Preset[]>('/api/presets');
  const workflows = useApi<WorkflowTemplate[]>('/api/workflows');
  const [p, setP] = useState<Editable | null>(isNew ? { name: '', emoji: '⭐', fields: { ...EMPTY_FIELDS }, params: {}, workflowId: null } : null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew || !presets.data || p) return;
    const found = presets.data.find((x) => x.id === id);
    if (found) setP({ name: found.name, emoji: found.emoji, fields: { ...EMPTY_FIELDS, ...found.fields }, params: found.params, workflowId: found.workflowId });
  }, [presets.data, id, isNew, p]);

  if (!p)
    return (
      <div className="flex justify-center pt-24">
        <Spinner />
      </div>
    );

  const setField = (k: keyof PromptFields, v: string) => setP({ ...p, fields: { ...p.fields, [k]: v } });

  async function save() {
    if (!p) return;
    if (!p.name.trim()) return toast('Give the preset a name', 'error');
    setSaving(true);
    try {
      await api(isNew ? '/api/presets' : `/api/presets/${id}`, { method: isNew ? 'POST' : 'PUT', json: p });
      toast('Preset saved');
      router.push('/library');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pb-nav">
      <PageHeader
        title={isNew ? 'New preset' : 'Edit preset'}
        right={
          <button onClick={() => router.back()} className="min-h-[44px] px-2 text-accent">
            Cancel
          </button>
        }
      />
      <Card className="space-y-3">
        <div className="grid grid-cols-[72px,1fr] gap-3">
          <TextInput label="Icon" value={p.emoji} maxLength={4} onChange={(e) => setP({ ...p, emoji: e.target.value })} />
          <TextInput label="Name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </div>
        <Select
          label="Workflow"
          value={p.workflowId ?? ''}
          onChange={(v) => setP({ ...p, workflowId: v || null })}
          placeholder="(default workflow)"
          options={(workflows.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
        />
      </Card>

      <SectionTitle>Prompt fields</SectionTitle>
      <Card className="space-y-3">
        {PROMPT_FIELD_KEYS.map((k) => (
          <TextArea key={k} label={PROMPT_FIELD_LABELS[k]} value={p.fields[k]} onChange={(e) => setField(k, e.target.value)} />
        ))}
      </Card>

      <SectionTitle>Size & sampling overrides</SectionTitle>
      <Card className="space-y-4">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          <Chip active={!p.params.width} onClick={() => setP({ ...p, params: { ...p.params, width: undefined, height: undefined } })}>
            Keep current
          </Chip>
          {SIZE_PRESETS.map((s) => (
            <Chip
              key={s.label}
              active={p.params.width === s.width && p.params.height === s.height}
              onClick={() => setP({ ...p, params: { ...p.params, width: s.width, height: s.height } })}
            >
              {s.label}
            </Chip>
          ))}
        </div>
        <OptionalSlider label="Steps" value={p.params.steps} min={4} max={80} step={1} def={28} onChange={(v) => setP({ ...p, params: { ...p.params, steps: v } })} />
        <OptionalSlider label="CFG / guidance" value={p.params.cfg} min={1} max={12} step={0.1} def={5} onChange={(v) => setP({ ...p, params: { ...p.params, cfg: v } })} />
        <OptionalSlider
          label="LoRA strength"
          value={p.params.loraStrength}
          min={0}
          max={1.5}
          step={0.05}
          def={0.85}
          onChange={(v) => setP({ ...p, params: { ...p.params, loraStrength: v } })}
        />
      </Card>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+72px)] z-10 pt-3">
        <Button variant="primary" className="h-12 w-full shadow-lg" loading={saving} onClick={save}>
          Save preset
        </Button>
      </div>
    </div>
  );
}

function OptionalSlider(props: { label: string; value: number | undefined; def: number; min: number; max: number; step: number; onChange: (v: number | undefined) => void }) {
  if (props.value === undefined) {
    return (
      <button className="flex min-h-[44px] w-full items-center justify-between text-sm" onClick={() => props.onChange(props.def)}>
        <span>{props.label}</span>
        <span className="text-ink-400">keep current · tap to override</span>
      </button>
    );
  }
  return (
    <div>
      <Slider label={props.label} value={props.value} min={props.min} max={props.max} step={props.step} onChange={props.onChange} />
      <button className="text-xs text-ink-400" onClick={() => props.onChange(undefined)}>
        clear override
      </button>
    </div>
  );
}
