'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, useApi } from '@/lib/client/api';
import { autoDetectBindings, CONTROL_INFO, findOutputNodes, validateBindings } from '@/lib/comfy/adapter';
import { canPrune, MODULE_KEYS, MODULE_LABELS } from '@/lib/comfy/modules';
import type { ControlKey, NodeInputRef, WorkflowTemplate } from '@/lib/types';
import { Badge, Button, Card, Collapsible, Notice, PageHeader, SectionTitle, Spinner, TextArea, TextInput, Toggle, cx, toast } from '@/components/ui';

const GROUPS: { title: string; keys: ControlKey[] }[] = [
  { title: 'Prompt', keys: ['positive_prompt', 'negative_prompt'] },
  { title: 'Model & LoRA', keys: ['checkpoint', 'lora_name', 'lora_strength', 'lora_clip_strength'] },
  { title: 'Sampling', keys: ['seed', 'steps', 'cfg', 'guidance', 'sampler', 'scheduler', 'denoise'] },
  { title: 'Size', keys: ['width', 'height', 'batch_size'] },
  { title: 'Reference & control', keys: ['face_reference_image', 'face_strength', 'init_image', 'pose_image', 'control_strength', 'controlnet_model'] },
  { title: 'Face refinement', keys: ['face_refine_denoise', 'face_refine_threshold'] },
  { title: 'Output', keys: ['filename_prefix'] },
];

export default function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error } = useApi<WorkflowTemplate>(`/api/workflows/${id}`);
  const [wf, setWf] = useState<WorkflowTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data) setWf(data);
  }, [data]);

  const problems = useMemo(() => (wf ? validateBindings(wf.graph, wf.bindings) : []), [wf]);
  const nodes = useMemo(
    () =>
      wf
        ? Object.entries(wf.graph).sort(([a], [b]) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b))
        : [],
    [wf],
  );

  if (error) return <p className="pt-20 text-center text-red-300">{error}</p>;
  if (!wf)
    return (
      <div className="flex justify-center pt-24">
        <Spinner />
      </div>
    );

  const setRefs = (key: ControlKey, refs: NodeInputRef[]) => setWf({ ...wf, bindings: { ...wf.bindings, [key]: refs } });

  /** Inputs on a node that hold literal values (links can't be bound). */
  const valueInputs = (nodeId: string) =>
    Object.entries(wf.graph[nodeId]?.inputs ?? {})
      .filter(([, v]) => !(Array.isArray(v) && v.length === 2 && typeof v[0] === 'string'))
      .map(([k]) => k);

  async function save() {
    if (!wf) return;
    setSaving(true);
    try {
      // drop empty binding lists
      const bindings = Object.fromEntries(Object.entries(wf.bindings).filter(([, v]) => v && v.length));
      const saved = await api<WorkflowTemplate>(`/api/workflows/${wf.id}`, {
        method: 'PUT',
        json: {
          name: wf.name,
          description: wf.description,
          bindings,
          outputNodeIds: wf.outputNodeIds,
          allowLoraInjection: wf.allowLoraInjection,
          optionalModules: (wf.optionalModules ?? []).filter((k) => canPrune(wf.graph, bindings, k)),
          graph: wf.graph,
        },
      });
      setWf(saved);
      toast('Workflow saved');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function replaceJson(f: File | undefined) {
    if (!f || !wf) return;
    try {
      const json = JSON.parse(await f.text());
      const { bindings } = await api<{ bindings: WorkflowTemplate['bindings'] }>('/api/workflows/detect', { method: 'POST', json: { json } });
      const graph = json.prompt ?? json;
      setWf({ ...wf, graph, bindings, outputNodeIds: [] });
      toast('JSON replaced and mapping re-detected. Review, then Save.');
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(wf!.graph, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${wf!.name.replace(/[^\w-]+/g, '_')}.json`;
    a.click();
  }

  const outputs = findOutputNodes(wf.graph);

  return (
    <div className="pb-nav">
      <PageHeader
        title="Workflow"
        subtitle={wf.builtIn ? 'Built-in (edits are saved as an override)' : 'Custom'}
        right={
          <button onClick={() => router.push('/library')} className="min-h-[44px] px-2 text-accent">
            Done
          </button>
        }
      />
      <Card className="space-y-3">
        <TextInput label="Name" value={wf.name} onChange={(e) => setWf({ ...wf, name: e.target.value })} />
        <TextArea label="Description" value={wf.description} onChange={(e) => setWf({ ...wf, description: e.target.value })} />
        <Toggle
          checked={wf.allowLoraInjection}
          onChange={(v) => setWf({ ...wf, allowLoraInjection: v })}
          label="Auto-inject Sienna LoRA"
          description="If the graph has no mapped LoRA node, splice a LoraLoader after the model loader."
        />
        <div className="space-y-1 border-t border-ink-800 pt-3">
          <p className="text-sm font-medium">Optional modules</p>
          <p className="text-xs text-ink-400">
            Optional modules are removed from the graph automatically when their image isn’t supplied or the server lacks their nodes. Required
            modules make generation fail without them.
          </p>
          {MODULE_KEYS.map((key) => {
            const mapped = (wf.bindings[key]?.length ?? 0) > 0;
            const prunable = mapped && canPrune(wf.graph, wf.bindings, key);
            const on = (wf.optionalModules ?? []).includes(key);
            return (
              <Toggle
                key={key}
                checked={on && prunable}
                disabled={!prunable}
                onChange={(v) =>
                  setWf({ ...wf, optionalModules: v ? [...(wf.optionalModules ?? []), key] : (wf.optionalModules ?? []).filter((k) => k !== key) })
                }
                label={MODULE_LABELS[key]}
                description={!mapped ? 'not in this workflow (map its image input first)' : prunable ? (on ? 'optional' : 'required') : 'cannot be removed cleanly from this graph — required'}
              />
            );
          })}
        </div>
        {outputs.length > 1 && (
          <div>
            <p className="mb-1 text-sm">Collect images from</p>
            <div className="flex flex-wrap gap-2">
              {outputs.map((o) => {
                const on = wf.outputNodeIds.includes(o);
                return (
                  <button
                    key={o}
                    onClick={() => setWf({ ...wf, outputNodeIds: on ? wf.outputNodeIds.filter((x) => x !== o) : [...wf.outputNodeIds, o] })}
                    className={cx('min-h-[40px] rounded-full px-3 text-sm', on ? 'bg-accent text-ink-950' : 'bg-ink-800')}
                  >
                    #{o} {wf.graph[o]._meta?.title ?? wf.graph[o].class_type}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-ink-400">None selected = all save nodes.</p>
          </div>
        )}
      </Card>

      {problems.length > 0 && (
        <div className="mt-3">
          <Notice kind="error">{problems.join(' · ')}</Notice>
        </div>
      )}

      <SectionTitle
        right={
          <button
            className="text-xs text-accent"
            onClick={() => {
              setWf({ ...wf, bindings: autoDetectBindings(wf.graph) });
              toast('Mapping re-detected (not saved yet)');
            }}
          >
            Auto-detect again
          </button>
        }
      >
        Control → node mapping
      </SectionTitle>
      <p className="mb-3 px-1 text-xs text-ink-400">
        Each app control writes its value into the chosen <b>node ID</b> + <b>input</b> of this workflow. Unmapped controls are simply not
        sent (the workflow’s own value is used).
      </p>

      <div className="space-y-3">
        {GROUPS.map((g) => (
          <Collapsible
            key={g.title}
            title={g.title}
            defaultOpen={g.title === 'Prompt'}
            badge={<Badge>{g.keys.filter((k) => wf.bindings[k]?.length).length}/{g.keys.length}</Badge>}
          >
            {g.keys.map((key) => {
              const refs = wf.bindings[key] ?? [];
              return (
                <div key={key} className="rounded-xl bg-ink-800/60 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{CONTROL_INFO[key].label}</p>
                    {refs.length === 0 && <span className="text-[11px] text-ink-400">unmapped</span>}
                  </div>
                  <p className="mb-2 text-[11px] text-ink-400">{CONTROL_INFO[key].hint}</p>
                  {refs.map((r, i) => (
                    <div key={i} className="mb-2 flex gap-2">
                      <select
                        value={r.nodeId}
                        onChange={(e) => {
                          const nodeId = e.target.value;
                          const inputs = valueInputs(nodeId);
                          const next = [...refs];
                          next[i] = { nodeId, inputName: inputs.includes(r.inputName) ? r.inputName : inputs[0] ?? '' };
                          setRefs(key, next);
                        }}
                        className="min-w-0 flex-[3] rounded-lg bg-ink-700 px-2 py-2 text-base"
                      >
                        {!wf.graph[r.nodeId] && <option value={r.nodeId}>#{r.nodeId} (missing!)</option>}
                        {nodes.map(([nid, n]) => (
                          <option key={nid} value={nid}>
                            #{nid} {n._meta?.title ?? n.class_type}
                          </option>
                        ))}
                      </select>
                      <select
                        value={r.inputName}
                        onChange={(e) => {
                          const next = [...refs];
                          next[i] = { ...r, inputName: e.target.value };
                          setRefs(key, next);
                        }}
                        className="min-w-0 flex-[2] rounded-lg bg-ink-700 px-2 py-2 text-base"
                      >
                        {valueInputs(r.nodeId).map((inp) => (
                          <option key={inp} value={inp}>
                            {inp}
                          </option>
                        ))}
                      </select>
                      <button
                        className="w-10 shrink-0 rounded-lg bg-ink-700"
                        aria-label="Remove mapping"
                        onClick={() => setRefs(key, refs.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    className="text-xs text-accent"
                    onClick={() => {
                      const first = nodes[0]?.[0] ?? '';
                      setRefs(key, [...refs, { nodeId: first, inputName: valueInputs(first)[0] ?? '' }]);
                    }}
                  >
                    + map {refs.length ? 'another node' : 'to a node'}
                  </button>
                </div>
              );
            })}
          </Collapsible>
        ))}

        <Collapsible title="Nodes in this workflow" badge={<Badge>{nodes.length}</Badge>}>
          <ul className="space-y-2 text-xs">
            {nodes.map(([nid, n]) => (
              <li key={nid} className="rounded-lg bg-ink-800 p-2">
                <p>
                  <span className="font-mono text-accent">#{nid}</span> <b>{n.class_type}</b>
                  {n._meta?.title && <span className="text-ink-400"> — {n._meta.title}</span>}
                </p>
                <p className="mt-1 break-words font-mono text-[11px] text-ink-400">
                  {Object.entries(n.inputs)
                    .map(([k, v]) => `${k}=${Array.isArray(v) ? `→#${v[0]}` : JSON.stringify(v)?.slice(0, 40)}`)
                    .join('  ')}
                </p>
              </li>
            ))}
          </ul>
        </Collapsible>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button onClick={() => replaceRef.current?.click()}>Replace JSON</Button>
        <Button onClick={download}>Download JSON</Button>
      </div>
      <input ref={replaceRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => replaceJson(e.target.files?.[0])} />
      <Button
        variant="danger"
        className="mt-2 w-full"
        onClick={async () => {
          if (!confirm(wf.builtIn ? 'Reset this built-in workflow to its original mapping?' : 'Delete this workflow?')) return;
          await api(`/api/workflows/${wf.id}`, { method: 'DELETE' });
          router.push('/library');
        }}
      >
        {wf.builtIn ? 'Reset to original' : 'Delete workflow'}
      </Button>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+72px)] z-10 pt-3">
        <Button variant="primary" className="h-12 w-full shadow-lg" loading={saving} disabled={problems.length > 0} onClick={save}>
          Save workflow
        </Button>
      </div>
    </div>
  );
}
