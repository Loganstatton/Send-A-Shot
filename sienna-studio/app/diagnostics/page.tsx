'use client';

import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/client/api';
import type { WorkflowTemplate } from '@/lib/types';
import type { CheckStatus, DiagnosticsReport, ModelInput } from '@/lib/server/diagnostics';
import { FirstTestCard } from '@/components/FirstTestCard';
import { Badge, Button, Card, Collapsible, Notice, PageHeader, SectionTitle, Select, Spinner, cx, toast } from '@/components/ui';

const ICON: Record<CheckStatus, { icon: string; cls: string }> = {
  pass: { icon: '✓', cls: 'bg-emerald-700 text-white' },
  warn: { icon: '!', cls: 'bg-amber-600 text-black' },
  fail: { icon: '✗', cls: 'bg-red-700 text-white' },
  skip: { icon: '–', cls: 'bg-ink-600 text-ink-200' },
};

export default function DiagnosticsPage() {
  const workflows = useApi<WorkflowTemplate[]>('/api/workflows');
  const settings = useApi<{ settings: { defaultWorkflowId: string | null } }>('/api/settings');
  const [workflowId, setWorkflowId] = useState<string>('');
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workflowId && settings.data) setWorkflowId(settings.data.settings.defaultWorkflowId ?? '');
  }, [settings.data, workflowId]);

  async function run(id = workflowId) {
    if (!id) return;
    setRunning(true);
    setError(null);
    try {
      setReport(await api<DiagnosticsReport>(`/api/diagnostics?workflowId=${encodeURIComponent(id)}`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (workflowId) run(workflowId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  async function setModel(mi: ModelInput, value: string) {
    try {
      await api('/api/diagnostics/model-input', { method: 'POST', json: { workflowId, nodeId: mi.nodeId, inputName: mi.inputName, value } });
      toast(`${mi.nodeTitle}: ${value}`);
      run();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  const counts = report?.checks.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <div className="pb-nav">
      <PageHeader
        title="Diagnostics"
        subtitle={report ? report.url : 'ComfyUI connection & workflow'}
        right={
          <Button className="h-10 min-h-0" loading={running} onClick={() => run()}>
            Re-run
          </Button>
        }
      />

      {report?.mock && (
        <div className="mock-stripes mb-3 rounded-2xl p-1">
          <div className="rounded-xl bg-ink-950 p-3 text-sm">
            <p className="font-bold text-amber-300">MOCK MODE</p>
            <p className="text-ink-200">No real ComfyUI server is being checked. Set your server URL in Settings → ComfyUI backend.</p>
          </div>
        </div>
      )}

      <Card className="space-y-2">
        <Select
          label="Workflow to check"
          value={workflowId}
          onChange={setWorkflowId}
          options={(workflows.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
        />
        {counts && (
          <div className="flex gap-2 text-xs">
            {(['pass', 'warn', 'fail'] as const).map((s) =>
              counts[s] ? (
                <Badge key={s} tone={s === 'pass' ? 'ok' : s === 'warn' ? 'warn' : 'error'}>
                  {counts[s]} {s}
                </Badge>
              ) : null,
            )}
          </div>
        )}
      </Card>

      {error && (
        <div className="mt-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {!report && running && (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {report && (
        <>
          <SectionTitle>Checks</SectionTitle>
          <div className="space-y-2">
            {report.checks.map((c) => (
              <div key={c.id} className="rounded-2xl bg-ink-900 p-3 ring-1 ring-ink-800">
                <div className="flex items-start gap-3">
                  <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold', ICON[c.status].cls)}>
                    {ICON[c.status].icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.label}</p>
                    <p className="break-words text-sm text-ink-400">{c.detail}</p>
                    {c.fix && <p className="mt-1 break-words text-xs text-amber-300">→ {c.fix}</p>}
                    {c.items && c.items.length > 0 && (
                      <details className="mt-1">
                        <summary className="min-h-[32px] cursor-pointer text-xs text-accent">Show {c.items.length} item(s)</summary>
                        <ul className="mt-1 space-y-1 break-words font-mono text-[11px] text-ink-200">
                          {c.items.map((i) => (
                            <li key={i}>{i}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {report.modelInputs.length > 0 && (
            <>
              <SectionTitle>Model files used by this workflow</SectionTitle>
              <p className="mb-2 px-1 text-xs text-ink-400">
                Defaults stored in the workflow. Pick files that exist on your server — the base model chosen here is what “(workflow default)” means
                on the Create screen. The Sienna LoRA is set on the Sienna tab.
              </p>
              <div className="space-y-2">
                {report.modelInputs.map((mi) => (
                  <Card key={`${mi.nodeId}.${mi.inputName}`} className={cx('space-y-2 p-3', !mi.valid && 'ring-red-800')}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">
                        <span className="font-mono text-xs text-accent">#{mi.nodeId}</span> {mi.nodeTitle} · <span className="text-ink-400">{mi.inputName}</span>
                      </span>
                      {mi.module ? <Badge>optional: {mi.module}</Badge> : null}
                    </div>
                    <Select
                      value={mi.value}
                      onChange={(v) => setModel(mi, v)}
                      options={mi.options.map((o) => ({ value: o, label: o }))}
                    />
                    {!mi.valid && <p className="text-xs text-red-300">“{mi.value}” is not on the server.{mi.module ? ' This module will fail if used.' : ''}</p>}
                  </Card>
                ))}
              </div>
            </>
          )}

          {report.dryRun && (
            <div className="mt-3">
              <Collapsible title="Dry run of the first test" badge={<Badge>{report.dryRun.nodeCount} nodes</Badge>}>
                <p className="text-sm text-ink-400">
                  Modules skipped: {report.dryRun.prunedModules.length ? report.dryRun.prunedModules.join(', ') : 'none'}
                </p>
                {report.dryRun.warnings.map((w, i) => (
                  <Notice key={i} kind="warn">
                    {w}
                  </Notice>
                ))}
                {report.dryRun.problems.map((p, i) => (
                  <Notice key={i} kind="error">
                    {p}
                  </Notice>
                ))}
              </Collapsible>
            </div>
          )}

          <SectionTitle>Test</SectionTitle>
          <FirstTestCard workflowId={workflowId || null} mock={report.mock} />
        </>
      )}
    </div>
  );
}
