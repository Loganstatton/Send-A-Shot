'use client';

import { useEffect, useRef, useState } from 'react';
import { fileUrl } from '@/lib/client/api';
import { runJob } from '@/lib/client/poll';
import type { FramingLevel } from '@/lib/framing';
import type { StoredImage } from '@/lib/types';
import { Button, Notice, Spinner } from './ui';

type Status =
  | { state: 'pending' | 'running'; position?: number }
  | { state: 'error'; error: string }
  | {
      state: 'done';
      skeleton: StoredImage | null;
      retargeted: StoredImage | null;
      keypoints: number[] | null;
      extent: FramingLevel | null;
      factors: Record<string, number> | null;
      proportionsSource: 'sienna' | 'generic';
      people: number;
    };

/**
 * "Check pose": runs only the pose detector (with the current fit/retarget settings) and shows
 * the skeleton the ControlNet will receive, plus the shot size it implies for the framing check.
 */
export function PoseCheck({
  image,
  width,
  height,
  fit,
  retarget,
  onExtent,
}: {
  image: StoredImage;
  width: number;
  height: number;
  fit: 'crop' | 'pad';
  retarget: number;
  onExtent: (extent: FramingLevel | null) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => () => void (cancelled.current = true), []);
  // Settings or photo changed → the previous check no longer describes what will be sent.
  const key = `${image.id}|${width}x${height}|${fit}|${retarget}`;
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    setStatus(null);
    onExtent(null);
  }, [key, onExtent]);

  async function check() {
    setBusy(true);
    setStatus({ state: 'pending' });
    try {
      const s = await runJob<Status>('/api/pose/analyze', { image, width, height, fit, retarget }, setStatus, () => cancelled.current, {
        pollMs: 1500,
        timeoutMs: 5 * 60 * 1000,
      });
      onExtent(s?.state === 'done' ? s.extent : null);
    } catch (e: any) {
      setStatus({ state: 'error', error: e.message });
    } finally {
      setBusy(false);
    }
  }

  const done = status?.state === 'done' ? status : null;
  const changed = done?.factors ? Object.entries(done.factors).filter(([, f]) => Math.abs(f - 1) >= 0.02) : [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button onClick={check} loading={busy} className="shrink-0">
          {done ? 'Re-check pose' : 'Check pose'}
        </Button>
        <p className="text-xs text-ink-400">Shows the skeleton the model will follow, and checks it against your framing.</p>
      </div>
      {status && status.state !== 'done' && status.state !== 'error' && (
        <p className="flex items-center gap-2 text-sm text-ink-400">
          <Spinner /> Detecting pose…
        </p>
      )}
      {status?.state === 'error' && <Notice kind="error">{status.error}</Notice>}
      {done && (
        <div className="space-y-2">
          {done.people === 0 && <Notice kind="warn">No person found in the pose photo — the pose will have no effect.</Notice>}
          {done.people > 1 && <Notice kind="warn">{done.people} people found — all of their skeletons are sent, which can add extra people.</Notice>}
          <div className="flex gap-2">
            {[
              { img: done.skeleton, label: 'Skeleton' },
              { img: done.retargeted, label: 'Retargeted (used)' },
            ]
              .filter((x) => x.img)
              .map((x) => (
                <div key={x.label} className="w-28">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(x.img!.file)} alt={x.label} className="w-full rounded-lg bg-black object-contain" />
                  <p className="mt-1 text-center text-[10px] text-ink-400">{x.label}</p>
                </div>
              ))}
          </div>
          <p className="text-xs text-ink-400">
            Shot implied by the pose: <b className="text-ink-200">{done.extent ?? 'unknown'}</b>
            {fit === 'crop' && ' · Crop mode: the model sees the middle of this, cut to the output shape.'}
          </p>
          {retarget > 0 && (
            <p className="text-xs text-ink-400">
              Retargeting to {done.proportionsSource === 'sienna' ? "Sienna's measured" : 'generic adult'} proportions
              {changed.length ? `: ${changed.map(([g, f]) => `${g.replace('_', ' ')} ${f > 1 ? '+' : ''}${Math.round((f - 1) * 100)}%`).join(', ')}` : ' — no bone changed by more than 2%.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
