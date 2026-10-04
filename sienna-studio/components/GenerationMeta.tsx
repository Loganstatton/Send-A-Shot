'use client';

import { fileUrl } from '@/lib/client/api';
import { MODULE_LABELS, ModuleKey } from '@/lib/comfy/modules';
import type { GenerationRecord, StoredImage } from '@/lib/types';
import { Badge, Button, Collapsible, Notice, toast } from './ui';

/** Every piece of metadata for a generation, including ComfyUI error details and the submitted graph. */
export function GenerationMeta({ rec, showPrompt = true }: { rec: GenerationRecord; showPrompt?: boolean }) {
  const date = new Date(rec.createdAt);
  const took = rec.completedAt ? Math.round((Date.parse(rec.completedAt) - Date.parse(rec.createdAt)) / 1000) : null;
  return (
    <div className="space-y-3">
      {rec.error && (
        <Notice kind="error">
          <p className="font-medium">ComfyUI error</p>
          <p className="mt-1 break-words">{rec.error}</p>
        </Notice>
      )}
      {rec.errorDetails != null && (
        <Collapsible title="Error details (raw)" defaultOpen={!!rec.error}>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-800 p-3 text-[11px]">
            {JSON.stringify(rec.errorDetails, null, 2)}
          </pre>
        </Collapsible>
      )}
      {rec.warnings.length > 0 && (
        <div className="space-y-2">
          {rec.warnings.map((w, i) => (
            <Notice key={i} kind="warn">
              {w}
            </Notice>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 rounded-2xl bg-ink-900 p-4 text-sm ring-1 ring-ink-800">
        <Meta k="Date" v={date.toLocaleString()} />
        <Meta k="Status" v={<Badge tone={rec.status === 'done' ? 'ok' : rec.status === 'error' ? 'error' : 'accent'}>{rec.status}</Badge>} />
        {took !== null && <Meta k="Duration" v={`${took}s`} />}
        <Meta k="Backend" v={rec.backend === 'mock' ? <Badge tone="warn">MOCK</Badge> : 'ComfyUI'} />
        <Meta k="Prompt ID" v={<span className="select-all break-all font-mono text-xs">{rec.promptId ?? '—'}</span>} />
        <Meta k="Seed" v={<span className="select-all">{rec.seed}</span>} />
        <Meta k="Workflow" v={rec.workflowName} />
        <Meta k="Preset" v={rec.presetName ?? 'Custom'} />
        <Meta k="Sienna Lock" v={rec.siennaLock ? 'On' : 'Off'} />
        <Meta k="Content" v={rec.contentMode === 'adult' ? 'Adult 18+' : 'SFW'} />
        <Meta k="LoRA" v={rec.lora ? `${rec.lora.name} @ ${rec.lora.strength} (clip ${rec.lora.clipStrength})${rec.lora.injected ? ' · injected' : ''}` : 'none'} />
        <Meta k="Model" v={rec.params.checkpoint || '(workflow default)'} />
        <Meta k="Size" v={`${rec.params.width}×${rec.params.height} · batch ${rec.params.batchSize}`} />
        <Meta k="Steps / CFG" v={`${rec.params.steps} / ${rec.params.cfg}`} />
        <Meta k="Sampler" v={`${rec.params.sampler || '—'} · ${rec.params.scheduler || '—'}`} />
        <Meta k="Denoise" v={rec.initImage ? rec.params.denoise : '1 (txt2img)'} />
        {rec.faceRefine && (
          <Meta
            k="Face refinement"
            v={
              rec.faceRefine.status === 'on'
                ? `on · denoise ${rec.faceRefine.denoise} · faces under ${rec.faceRefine.threshold}px`
                : rec.faceRefine.status === 'off'
                  ? 'off'
                  : `skipped (${rec.faceRefine.reason})`
            }
          />
        )}
        <Meta
          k="Modules"
          v={
            rec.prunedModules?.length
              ? `skipped: ${rec.prunedModules.map((m) => MODULE_LABELS[m as ModuleKey] ?? m).join(', ')}`
              : 'all used'
          }
        />
      </dl>
      <div className="flex gap-3">
        <RefThumb label="Face ref" img={rec.faceReference} />
        <RefThumb label="Init" img={rec.initImage} />
        <RefThumb label="Pose" img={rec.poseImage} />
      </div>
      {showPrompt && (
        <Collapsible title="Prompt used">
          <p className="select-text whitespace-pre-wrap rounded-xl bg-ink-800 p-3 text-sm">{rec.positivePrompt}</p>
          <p className="select-text whitespace-pre-wrap rounded-xl bg-ink-800 p-3 text-sm text-ink-400">{rec.negativePrompt}</p>
          <Button variant="ghost" className="w-full" onClick={() => navigator.clipboard?.writeText(rec.positivePrompt).then(() => toast('Copied'))}>
            Copy prompt
          </Button>
        </Collapsible>
      )}
      {rec.submittedGraph && (
        <Collapsible title="Graph sent to ComfyUI" badge={<Badge>{Object.keys(rec.submittedGraph).length} nodes</Badge>}>
          <pre className="max-h-96 overflow-auto rounded-xl bg-ink-800 p-3 text-[11px]">{JSON.stringify(rec.submittedGraph, null, 2)}</pre>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => navigator.clipboard?.writeText(JSON.stringify(rec.submittedGraph, null, 2)).then(() => toast('Graph JSON copied'))}
          >
            Copy graph JSON
          </Button>
        </Collapsible>
      )}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-400">{k}</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </>
  );
}

function RefThumb({ label, img }: { label: string; img: StoredImage | null }) {
  if (!img) return null;
  return (
    <div className="text-center text-[11px] text-ink-400">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fileUrl(img.file)} alt={label} className="mb-1 h-20 w-16 rounded-lg object-cover" />
      {label}
    </div>
  );
}
