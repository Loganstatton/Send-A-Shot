'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, fileUrl, useApi } from '@/lib/client/api';
import { trackJob } from '@/lib/client/jobs';
import { capabilities } from '@/lib/comfy/adapter';
import { builtinPresets, DEFAULT_PARAMS, EMPTY_FIELDS } from '@/lib/defaults';
import type { AppSettings, CharacterProfile, GenerationRecord, WorkflowTemplate } from '@/lib/types';
import { CharacterEditor } from '@/components/CharacterEditor';
import { ConnectionTester } from '@/components/ConnectionTester';
import { Badge, Button, Card, Notice, Spinner, cx, toast } from '@/components/ui';

interface Payload {
  settings: AppSettings;
  env: { envComfyUrl: string; mock: boolean; effectiveComfyUrl: string };
}

const STEPS = ['Welcome', 'ComfyUI URL', 'Test connection', 'Reference images', 'Sienna LoRA', 'Workflow', 'First generation'];

export default function SetupWizard() {
  const router = useRouter();
  const settingsQ = useApi<Payload>('/api/settings');
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (settingsQ.data && step === null) {
      const s = settingsQ.data.settings;
      setStep(s.setupComplete ? 0 : Math.min(s.setupStep, STEPS.length - 1));
    }
  }, [settingsQ.data, step]);

  if (!settingsQ.data || step === null)
    return (
      <div className="flex justify-center pt-24">
        <Spinner />
      </div>
    );

  const go = (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0 });
    api('/api/settings', { method: 'PUT', json: { setupStep: n } }).catch(() => {});
  };

  async function finish() {
    await api('/api/settings', { method: 'PUT', json: { setupComplete: true, setupStep: 0 } });
    router.replace('/');
  }

  return (
    <div className="pb-10 pt-[calc(env(safe-area-inset-top)+16px)]">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-ink-400">
          Step {step + 1} of {STEPS.length} · <span className="text-ink-200">{STEPS[step]}</span>
        </p>
        <button className="min-h-[44px] px-2 text-sm text-ink-400" onClick={finish}>
          Skip setup
        </button>
      </div>
      <div className="mb-6 flex gap-1">
        {STEPS.map((_, i) => (
          <div key={i} className={cx('h-1 flex-1 rounded-full', i <= step ? 'bg-accent' : 'bg-ink-700')} />
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">Welcome to Sienna Studio</h1>
          <p className="text-ink-200">
            This app keeps your fictional adult character <b>Sienna</b> consistent across images while you change outfit, pose, setting,
            lighting and camera. Generation runs on a ComfyUI server (cloud GPU or your own PC).
          </p>
          <Notice kind="info">
            Sienna is fictional. Reference images must be of the character (e.g. her own renders), never photos of a real person.
            Content is always adult-only.
          </Notice>
          <p className="text-sm text-ink-400">No GPU yet? Choose mock mode in the next step — everything works with placeholder images.</p>
          <Button variant="primary" className="h-12 w-full" onClick={() => go(1)}>
            Get started
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">Add your ComfyUI server</h1>
          <Card className="space-y-2 text-sm text-ink-400">
            <p>Examples:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                RunPod: <code className="text-ink-200">https://&lt;pod-id&gt;-8188.proxy.runpod.net</code>
              </li>
              <li>
                Own PC (same Wi-Fi / Tailscale): <code className="text-ink-200">http://100.x.y.z:8188</code>
              </li>
              <li>
                Offline test: <code className="text-ink-200">mock</code>
              </li>
            </ul>
          </Card>
          <ConnectionTester
            initialUrl={settingsQ.data.settings.comfyUrl}
            envUrl={settingsQ.data.env.envComfyUrl}
            onSaved={async () => {
              await settingsQ.reload();
              go(2);
            }}
          />
          <Nav back={() => go(0)} />
        </div>
      )}

      {step === 2 && <TestStep onBack={() => go(1)} onNext={() => go(3)} />}

      {step === 3 && (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">Sienna’s identity & references</h1>
          <p className="text-sm text-ink-400">Set her core traits and upload a clear face reference (plus optional extra angles).</p>
          <CharacterEditor sections={['identity', 'refs']} saveLabel="Save & continue" onSaved={() => go(4)} />
          <Nav back={() => go(2)} next={() => go(4)} nextLabel="Skip for now" />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <h1 className="text-xl font-semibold">Select the Sienna LoRA</h1>
          <p className="text-sm text-ink-400">
            Pick the LoRA file from your ComfyUI server (it must be in <code>ComfyUI/models/loras</code>). No LoRA yet? Leave it empty —
            Sienna Lock will rely on the trigger, traits and face reference until you add one.
          </p>
          <CharacterEditor sections={['lora']} saveLabel="Save & continue" onSaved={() => go(5)} />
          <Nav back={() => go(3)} next={() => go(5)} nextLabel="Skip" />
        </div>
      )}

      {step === 5 && <WorkflowStep defaultId={settingsQ.data.settings.defaultWorkflowId} onBack={() => go(4)} onNext={() => go(6)} />}

      {step === 6 && <FirstRunStep onBack={() => go(5)} onFinish={finish} />}
    </div>
  );
}

function Nav({ back, next, nextLabel = 'Next' }: { back?: () => void; next?: () => void; nextLabel?: string }) {
  return (
    <div className="flex gap-2 pt-2">
      {back && (
        <Button variant="ghost" className="flex-1" onClick={back}>
          Back
        </Button>
      )}
      {next && (
        <Button className="flex-1" onClick={next}>
          {nextLabel}
        </Button>
      )}
    </div>
  );
}

function TestStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [state, setState] = useState<{ ok: boolean; text: string; mock?: boolean } | null>(null);

  async function run() {
    setState(null);
    try {
      const r = await api<{ backend: string; comfyuiVersion?: string; devices: { name: string }[]; latencyMs: number }>('/api/comfy/test', {
        method: 'POST',
        json: {},
      });
      const opts = await api<{ options: Record<string, string[]>; error: string | null }>('/api/comfy/options');
      const n = (k: string) => opts.options[k]?.length ?? 0;
      setState({
        ok: true,
        mock: r.backend === 'mock',
        text:
          r.backend === 'mock'
            ? 'Mock mode is active. Generations will produce placeholder images.'
            : `Connected (${r.latencyMs} ms) · ${r.devices.map((d) => d.name).join(', ')} · ${n('checkpoint')} models, ${n('lora_name')} LoRAs, ${n('sampler')} samplers found.`,
      });
    } catch (e: any) {
      setState({ ok: false, text: e.message });
    }
  }

  useEffect(() => {
    run();
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Testing connection</h1>
      {!state && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      {state && <Notice kind={state.ok ? (state.mock ? 'warn' : 'ok') : 'error'}>{state.text}</Notice>}
      {state && !state.ok && (
        <Card className="space-y-1 text-sm text-ink-400">
          <p className="text-ink-200">Troubleshooting</p>
          <p>• Is the GPU pod running and ComfyUI started (port 8188)?</p>
          <p>• RunPod: expose HTTP port 8188 and use the proxy URL.</p>
          <p>• Own PC: start ComfyUI with --listen 0.0.0.0 and make sure the app server can reach it.</p>
          <p>• Behind auth? set COMFYUI_API_KEY or COMFYUI_EXTRA_HEADERS on the app server.</p>
        </Card>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" onClick={run}>
          Retry
        </Button>
        <Button variant="primary" className="flex-1" disabled={!state?.ok} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}

function WorkflowStep({ defaultId, onBack, onNext }: { defaultId: string | null; onBack: () => void; onNext: () => void }) {
  const { data } = useApi<WorkflowTemplate[]>('/api/workflows');
  const [selected, setSelected] = useState(defaultId ?? '');

  async function save() {
    await api('/api/settings', { method: 'PUT', json: { defaultWorkflowId: selected } });
    onNext();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Assign a workflow</h1>
      <p className="text-sm text-ink-400">
        This is the default ComfyUI graph for every preset. You can upload your own (Export → API format) later in Library and assign different
        workflows per preset.
      </p>
      {(data ?? []).map((w) => {
        const caps = capabilities(w.bindings);
        return (
          <button
            key={w.id}
            onClick={() => setSelected(w.id)}
            className={cx('block w-full rounded-2xl bg-ink-900 p-4 text-left ring-1', selected === w.id ? 'ring-2 ring-accent' : 'ring-ink-800')}
          >
            <p className="font-medium">{w.name}</p>
            <p className="mt-1 text-xs text-ink-400">{w.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {caps.lora && <Badge>LoRA</Badge>}
              {caps.faceReference && <Badge tone="ok">Face ref</Badge>}
              {caps.pose && <Badge>Pose</Badge>}
              {caps.img2img && <Badge>img2img</Badge>}
            </div>
          </button>
        );
      })}
      <Notice kind="info">Start with “SDXL · text-to-image + LoRA” — it uses only stock ComfyUI nodes.</Notice>
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" className="flex-1" disabled={!selected} onClick={save}>
          Use this workflow
        </Button>
      </div>
    </div>
  );
}

function FirstRunStep({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
  const character = useApi<CharacterProfile>('/api/character');
  const settings = useApi<Payload>('/api/settings');
  const [job, setJob] = useState<GenerationRecord | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return;
    const t = setInterval(() => api<GenerationRecord>(`/api/history/${job.id}/status`).then(setJob).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [job]);

  async function run() {
    if (!character.data || !settings.data) return;
    setBusy(true);
    try {
      const preset = builtinPresets().find((p) => p.id === 'studio-neutral')!;
      const rec = await api<GenerationRecord>('/api/generate', {
        method: 'POST',
        json: {
          presetId: preset.id,
          workflowId: null,
          siennaLock: true,
          contentMode: 'sfw',
          fields: { ...EMPTY_FIELDS, ...preset.fields },
          params: {
            ...DEFAULT_PARAMS,
            ...settings.data.settings.defaultParams,
            ...preset.params,
            loraStrength: character.data.loraWeight,
            loraClipStrength: character.data.loraClipWeight,
          },
          images: { initImage: null, poseImage: null, faceReferenceId: null },
        },
      });
      trackJob(rec.id);
      setJob(rec);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">First test generation</h1>
      <p className="text-sm text-ink-400">A neutral studio portrait with Sienna Lock on — the best way to check identity.</p>
      {job ? (
        <Card className="overflow-hidden p-0">
          {job.status === 'done' && job.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(job.images[0].file)} alt="First test" className="w-full" />
          ) : job.status === 'error' ? (
            <div className="p-4">
              <Notice kind="error">{job.error}</Notice>
            </div>
          ) : (
            <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 text-sm text-ink-400">
              <Spinner className="h-8 w-8" />
              {job.status === 'queued' ? 'Queued…' : 'Generating…'} (first run on a cold GPU can take a few minutes)
            </div>
          )}
          {job.warnings.length > 0 && (
            <div className="space-y-1 p-3">
              {job.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-300">
                  {w}
                </p>
              ))}
            </div>
          )}
        </Card>
      ) : null}
      <Button variant={job?.status === 'done' ? 'secondary' : 'primary'} className="h-12 w-full" loading={busy} onClick={run}>
        {job ? 'Run again' : 'Generate test image'}
      </Button>
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button variant={job?.status === 'done' ? 'primary' : 'secondary'} className="flex-1" onClick={onFinish}>
          Finish setup
        </Button>
      </div>
      <p className="text-center text-xs text-ink-400">
        Problems? Check <Link href="/library" className="text-accent">workflow mapping</Link> or <Link href="/settings" className="text-accent">settings</Link>.
      </p>
    </div>
  );
}
