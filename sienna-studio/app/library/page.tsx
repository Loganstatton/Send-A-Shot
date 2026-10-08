'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, useApi } from '@/lib/client/api';
import { capabilities } from '@/lib/comfy/adapter';
import type { AppSettings, Preset, WorkflowTemplate } from '@/lib/types';
import { Badge, Button, Card, Chip, PageHeader, Select, TextInput, toast } from '@/components/ui';

export default function LibraryPage() {
  const [tab, setTab] = useState<'presets' | 'workflows'>('presets');
  return (
    <div className="pb-nav">
      <PageHeader title="Library" subtitle="Presets & ComfyUI workflows" />
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Chip active={tab === 'presets'} onClick={() => setTab('presets')} className="w-full">
          Presets
        </Chip>
        <Chip active={tab === 'workflows'} onClick={() => setTab('workflows')} className="w-full">
          Workflows
        </Chip>
      </div>
      {tab === 'presets' ? <PresetsTab /> : <WorkflowsTab />}
    </div>
  );
}

function PresetsTab() {
  const presets = useApi<Preset[]>('/api/presets');
  const workflows = useApi<WorkflowTemplate[]>('/api/workflows');

  async function duplicate(p: Preset) {
    try {
      await api('/api/presets', {
        method: 'POST',
        json: { name: `${p.name} copy`, emoji: p.emoji, fields: p.fields, params: p.params, workflowId: p.workflowId },
      });
      presets.reload();
      toast('Duplicated');
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function remove(p: Preset) {
    if (!confirm(`Delete preset “${p.name}”?`)) return;
    await api(`/api/presets/${p.id}`, { method: 'DELETE' });
    presets.reload();
  }

  const wfOptions = (workflows.data ?? []).map((w) => ({ value: w.id, label: w.name }));

  return (
    <div className="space-y-3">
      <Link href="/library/presets/new">
        <Button variant="primary" className="w-full">
          + New preset
        </Button>
      </Link>
      <Card className="divide-y divide-ink-800 p-0">
        {(presets.data ?? []).map((p) => {
          const wf = p.workflowId ? wfOptions.find((o) => o.value === p.workflowId)?.label ?? p.workflowId : null;
          return (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2">
              <Link href={`/library/presets/${p.id}`} className="flex min-h-[48px] min-w-0 flex-1 items-center gap-3">
                <span className="text-2xl">{p.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.builtIn && (
                      <span className="shrink-0 whitespace-nowrap">
                        <Badge>built-in</Badge>
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-ink-400">
                    {wf ? `${wf} · ` : ''}
                    {[p.fields.setting, p.fields.camera].filter(Boolean).join(' · ') || 'No fields set'}
                  </span>
                </span>
              </Link>
              <button onClick={() => duplicate(p)} aria-label={`Duplicate ${p.name}`} className="h-10 w-10 shrink-0 rounded-lg text-ink-400 hover:bg-ink-800">
                ⧉
              </button>
              <button onClick={() => remove(p)} aria-label={`Delete ${p.name}`} className="h-10 w-10 shrink-0 rounded-lg text-ink-400 hover:bg-ink-800">
                🗑
              </button>
            </div>
          );
        })}
      </Card>
      <p className="px-1 text-xs text-ink-400">Tap a preset to edit it (including which workflow it uses). ⧉ duplicates, 🗑 deletes.</p>
      <Button
        variant="ghost"
        className="w-full"
        onClick={async () => {
          if (!confirm('Restore the built-in presets to their original contents? Custom presets are kept.')) return;
          await api('/api/presets/reset', { method: 'POST' });
          presets.reload();
          toast('Built-in presets restored');
        }}
      >
        Restore built-in presets
      </Button>
    </div>
  );
}

function WorkflowsTab() {
  const workflows = useApi<WorkflowTemplate[]>('/api/workflows');
  const settings = useApi<{ settings: AppSettings }>('/api/settings');
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const defaultId = settings.data?.settings.defaultWorkflowId;

  async function upload(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const json = JSON.parse(await f.text());
      const wf = await api<WorkflowTemplate>('/api/workflows', {
        method: 'POST',
        json: { name: name || f.name.replace(/\.json$/i, ''), json },
      });
      setName('');
      toast('Workflow added — review the auto-detected mapping.');
      window.location.href = `/library/workflows/${wf.id}`;
    } catch (e: any) {
      toast(e instanceof SyntaxError ? 'That file is not valid JSON.' : e.message, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function setDefault(id: string) {
    await api('/api/settings', { method: 'PUT', json: { defaultWorkflowId: id } });
    settings.reload();
    toast('Default workflow set');
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <p className="font-medium">Upload a ComfyUI workflow</p>
        <p className="text-xs text-ink-400">
          In ComfyUI: <b>Workflow → Export (API)</b>. Node mapping is auto-detected; you can adjust it afterwards.
        </p>
        <TextInput placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="primary" className="w-full" loading={busy} onClick={() => fileRef.current?.click()}>
          Choose .json file
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      </Card>

      {(workflows.data ?? []).map((w) => {
        const caps = capabilities(w.bindings);
        return (
          <Card key={w.id} className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{w.name}</p>
                <p className="text-xs text-ink-400">{w.description}</p>
              </div>
              {w.id === defaultId && <Badge tone="accent">default</Badge>}
            </div>
            <div className="flex flex-wrap gap-1">
              {caps.lora && <Badge>LoRA</Badge>}
              {caps.faceReference && <Badge tone="ok">Face ref</Badge>}
              {caps.pose && <Badge>Pose</Badge>}
              {caps.img2img && <Badge>img2img</Badge>}
              {caps.guidance && <Badge>Flux guidance</Badge>}
              {w.builtIn && <Badge>built-in</Badge>}
              <Badge>{Object.keys(w.graph).length} nodes</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/library/workflows/${w.id}`}>
                <Button className="w-full">Edit mapping</Button>
              </Link>
              <Button disabled={w.id === defaultId} onClick={() => setDefault(w.id)}>
                Make default
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
