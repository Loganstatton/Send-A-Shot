'use client';

import { useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '@/lib/client/api';
import { OUTFIT_ATTRIBUTE_KEYS, OUTFIT_ATTRIBUTE_LABELS, OUTFIT_LIMITATIONS, OUTFIT_MAX_STRENGTH, OUTFIT_MODE_LABELS, OUTFIT_RECOMMENDED, OutfitAnalysis } from '@/lib/outfit';
import type { StoredImage } from '@/lib/types';
import { Button, Notice, Slider, Spinner, toast } from './ui';

type Status =
  | { state: 'pending' | 'running'; position?: number }
  | { state: 'error'; error: string }
  | ({ state: 'done'; preview: StoredImage | null } & OutfitAnalysis);

const POLL_MS = 2000;
// Generous: the analysis waits in the same GPU queue as any running generations.
const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Outfit reference panel, shown under the photo tiles once an outfit photo is
 * picked: optional analysis (clothing-only crop + description) and strength.
 */
export function OutfitReference({
  enabled,
  image,
  strength,
  onStrength,
  outfitText,
  onUseText,
}: {
  enabled: boolean;
  image: StoredImage | null;
  strength: number;
  onStrength: (v: number) => void;
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

  const found = done ? OUTFIT_ATTRIBUTE_KEYS.filter((k) => done.attributes[k].length) : [];
  const missing = done ? OUTFIT_ATTRIBUTE_KEYS.filter((k) => !done.attributes[k].length) : [];

  return (
    <div className="space-y-3">
      {!done && (
        <div className="flex items-center gap-3">
          <Button onClick={analyze} loading={busy} disabled={!image || !enabled} className="shrink-0">
            Analyze outfit
          </Button>
          <p className="text-xs text-ink-400">Optional — shows what the model sees and writes the Outfit text for you.</p>
        </div>
      )}

      {status && status.state !== 'done' && status.state !== 'error' && (
        <p className="flex items-center gap-2 text-sm text-ink-400">
          <Spinner /> {status.state === 'running' ? 'Analyzing outfit…' : `Queued${status.position ? ` (#${status.position})` : ''}…`}
        </p>
      )}
      {status?.state === 'error' && <Notice kind="error">{status.error}</Notice>}

      {done && (
        <div className="space-y-3">
          {done.notes.map((n, i) => (
            <Notice key={i} kind="warn">
              {n}
            </Notice>
          ))}
          <div className="flex gap-3">
            {done.preview && (
              <div className="w-24 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(done.preview.file)} alt="Clothing-only crop" className="aspect-[3/4] w-full rounded-lg bg-ink-800 object-contain" />
                <p className="mt-1 text-center text-[10px] text-ink-400">What the model sees</p>
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="select-text rounded-xl bg-ink-800 p-2.5 text-sm">{done.outfitText || '—'}</p>
              <div className="flex flex-wrap gap-1">
                {found.flatMap((k) =>
                  done.attributes[k].map((v) => (
                    <span key={k + v} className="rounded-full bg-ink-800 px-2 py-0.5 text-[11px] text-ink-200" title={OUTFIT_ATTRIBUTE_LABELS[k]}>
                      {v}
                    </span>
                  )),
                )}
              </div>
              {missing.length > 0 && (
                <p className="text-[11px] text-ink-400">Not detected: {missing.map((k) => OUTFIT_ATTRIBUTE_LABELS[k].toLowerCase()).join(', ')}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant="primary"
              disabled={!done.outfitText || done.outfitText === outfitText}
              onClick={() => {
                onUseText(done.outfitText);
                toast('Outfit text updated');
              }}
            >
              {done.outfitText && done.outfitText === outfitText ? 'Outfit text set ✓' : 'Use as Outfit text'}
            </Button>
            <Button variant="ghost" onClick={analyze} loading={busy}>
              Re-analyze
            </Button>
          </div>
        </div>
      )}

      <Slider
        label="Outfit strength"
        hint={`${OUTFIT_RECOMMENDED} works best`}
        value={Math.min(strength, OUTFIT_MAX_STRENGTH)}
        min={0}
        max={OUTFIT_MAX_STRENGTH}
        step={0.05}
        onChange={onStrength}
      />

      <details className="text-xs text-ink-400">
        <summary>How this works &amp; limitations</summary>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>{OUTFIT_MODE_LABELS.design}: the outfit follows the photo; pose and background come from your prompt.</li>
          {OUTFIT_LIMITATIONS.map((l) => (
            <li key={l}>{l}</li>
          ))}
          {done && (
            <li>
              Raw caption: <span className="select-text">{done.caption || '—'}</span>
            </li>
          )}
        </ul>
      </details>
    </div>
  );
}
