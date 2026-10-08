'use client';

import { useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '@/lib/client/api';
import { OUTFIT_ATTRIBUTE_KEYS, OUTFIT_ATTRIBUTE_LABELS, OUTFIT_LIMITATIONS, OUTFIT_MAX_STRENGTH, OUTFIT_MODE_LABELS, OUTFIT_MODES_OFFERED, OUTFIT_RECOMMENDED, OutfitAnalysis } from '@/lib/outfit';
import type { OutfitMode, StoredImage } from '@/lib/types';
import { ImagePicker } from './ImagePicker';
import { Button, Notice, Select, Slider, Spinner, toast } from './ui';

type Status =
  | { state: 'pending' | 'running'; position?: number }
  | { state: 'error'; error: string }
  | ({ state: 'done'; preview: StoredImage | null } & OutfitAnalysis);

const POLL_MS = 2000;
// Generous: the analysis waits in the same GPU queue as any running generations.
const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Outfit reference: upload a photo of an outfit, check what the app extracted
 * (garment-only crop + description), then generate Sienna wearing it.
 */
export function OutfitReference({
  enabled,
  needsReset,
  image,
  onImage,
  strength,
  onStrength,
  mode,
  onMode,
  outfitText,
  onUseText,
}: {
  enabled: boolean;
  /** The saved copy of the production workflow predates the outfit nodes. */
  needsReset?: boolean;
  image: StoredImage | null;
  onImage: (img: StoredImage | null) => void;
  strength: number;
  onStrength: (v: number) => void;
  mode: OutfitMode;
  onMode: (m: OutfitMode) => void;
  outfitText: string;
  onUseText: (text: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => () => void (cancelled.current = true), []);

  // A new photo invalidates the previous analysis.
  useEffect(() => setStatus(null), [image?.id]);

  async function analyze() {
    if (!image) return;
    setBusy(true);
    setStatus({ state: 'pending' });
    try {
      const { promptId } = await api<{ promptId: string }>('/api/outfit/analyze', { method: 'POST', json: { image } });
      const started = Date.now();
      while (!cancelled.current) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const s = await api<Status>(`/api/outfit/analyze?promptId=${encodeURIComponent(promptId)}`);
        setStatus(s);
        if (s.state === 'done' || s.state === 'error') break;
        if (Date.now() - started > TIMEOUT_MS) {
          setStatus({ state: 'error', error: 'Analysis timed out. Is the GPU server running?' });
          break;
        }
      }
    } catch (e: any) {
      setStatus({ state: 'error', error: e.message });
    } finally {
      setBusy(false);
    }
  }

  const done = status?.state === 'done' ? status : null;

  return (
    <div className="space-y-3 rounded-xl bg-ink-900/60 p-3 ring-1 ring-ink-800">
      <div className="grid grid-cols-2 gap-3">
        <ImagePicker
          label="Outfit reference"
          value={image}
          onChange={onImage}
          disabled={!enabled}
          hint={
            enabled
              ? 'Photo of the outfit — only the clothes are used, never the face'
              : needsReset
                ? 'Your saved copy of this workflow predates outfit reference — Reset it in Library → Workflows'
                : 'Pick the Sienna Production · SDXL workflow'
          }
        />
        {done?.preview ? (
          <div>
            <p className="mb-1 text-sm text-ink-200">What the model sees</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(done.preview.file)} alt="Garment-only crop" className="aspect-[3/4] w-full rounded-xl bg-ink-800 object-contain" />
          </div>
        ) : (
          <div className="flex flex-col justify-end gap-2">
            <Button onClick={analyze} loading={busy} disabled={!image || !enabled}>
              Analyze outfit
            </Button>
            <p className="text-xs text-ink-400">Shows the garment-only crop and a description before you generate.</p>
          </div>
        )}
      </div>

      {status && status.state !== 'done' && status.state !== 'error' && (
        <p className="flex items-center gap-2 text-sm text-ink-400">
          <Spinner /> {status.state === 'running' ? 'Analyzing outfit…' : `Queued${status.position ? ` (#${status.position})` : ''}…`}
        </p>
      )}
      {status?.state === 'error' && <Notice kind="error">{status.error}</Notice>}

      {done && (
        <div className="space-y-2">
          {done.notes.map((n, i) => (
            <Notice key={i} kind="warn">
              {n}
            </Notice>
          ))}
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            {OUTFIT_ATTRIBUTE_KEYS.map((k) => (
              <div key={k} className="contents">
                <dt className="text-ink-400">{OUTFIT_ATTRIBUTE_LABELS[k]}</dt>
                <dd className={done.attributes[k].length ? 'text-ink-100' : 'text-ink-500'}>
                  {done.attributes[k].length ? done.attributes[k].join(', ') : 'not detected'}
                </dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-ink-400">Outfit description</p>
            <p className="select-text rounded-xl bg-ink-800 p-3 text-sm">{done.outfitText || '—'}</p>
          </div>
          <details className="text-xs text-ink-400">
            <summary>Raw Florence-2 caption</summary>
            <p className="mt-1 select-text">{done.caption || '—'}</p>
          </details>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant="primary"
              disabled={!done.outfitText || done.outfitText === outfitText}
              onClick={() => {
                onUseText(done.outfitText);
                toast('Outfit field updated — check the Final prompt.');
              }}
            >
              Use as Outfit text
            </Button>
            <Button variant="ghost" onClick={analyze} loading={busy}>
              Re-analyze
            </Button>
          </div>
        </div>
      )}

      {enabled && (
        <>
          <Slider
            label="Outfit strength"
            hint={`independent of LoRA strength · ${OUTFIT_RECOMMENDED} works best`}
            value={Math.min(strength, OUTFIT_MAX_STRENGTH)}
            min={0}
            max={OUTFIT_MAX_STRENGTH}
            step={0.05}
            onChange={onStrength}
          />
          {OUTFIT_MODES_OFFERED.length > 1 ? (
            <Select
              label="Outfit mode"
              value={mode}
              onChange={(v) => onMode(v === 'close' ? 'close' : 'design')}
              options={OUTFIT_MODES_OFFERED.map((m) => ({ value: m, label: OUTFIT_MODE_LABELS[m] }))}
            />
          ) : (
            <p className="text-xs text-ink-400">Mode: {OUTFIT_MODE_LABELS.design} — the outfit follows the photo; pose and background come from your prompt.</p>
          )}
        </>
      )}

      {image && (
        <details className="text-xs text-ink-400">
          <summary>Limitations</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {OUTFIT_LIMITATIONS.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
