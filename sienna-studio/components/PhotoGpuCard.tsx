'use client';

import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/client/api';
import { Button, Card, SectionTitle, toast } from '@/components/ui';

interface PhotoGpuView {
  mode: 'on-demand' | 'settings-url';
  status: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' | 'off';
  gpu?: string;
  rate?: number;
  phase?: string;
  error?: string;
  sessionUsd?: number;
  monthUsd: number;
  budgetUsd: number;
  idleMin?: number;
  dataCenter?: string;
}

/** The on-demand photo GPU (PHOTO_GPU=runpod): status, Start / Stop, cost. Renders nothing in the old fixed-URL mode. */
export function PhotoGpuCard() {
  const q = useApi<PhotoGpuView>('/api/photo-gpu');
  const [busy, setBusy] = useState(false);
  const gpu = q.data;
  const live = gpu && (gpu.status === 'starting' || gpu.status === 'ready' || gpu.status === 'stopping');

  useEffect(() => {
    const t = setInterval(() => q.reload(), live ? 10_000 : 30_000);
    return () => clearInterval(t);
  }, [live, q.reload]);

  if (!gpu || gpu.mode !== 'on-demand') return null;
  const label =
    gpu.status === 'starting'
      ? `Starting${gpu.phase ? ` — ${gpu.phase}` : ''} (usually 1–3 min)`
      : gpu.status === 'ready'
        ? `On${gpu.gpu ? ` · ${gpu.gpu.replace(/^NVIDIA (GeForce )?/, '')}` : ''} · switches off ${gpu.idleMin ?? 10} min after your last photo`
        : gpu.status === 'stopping'
          ? 'Switching off…'
          : 'Off — switches on by itself when you make a photo';

  const act = async (what: 'start' | 'stop') => {
    if (what === 'stop' && !confirm('Switch the photo GPU off now? Photos still waiting for it will fail.')) return;
    setBusy(true);
    try {
      q.setData(await api<PhotoGpuView>(`/api/photo-gpu/${what}`, { method: 'POST' }));
      toast(what === 'stop' ? 'Photo GPU switched off' : 'Photo GPU starting');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="my-3 space-y-1">
      <SectionTitle
        right={
          live ? (
            <Button loading={busy} onClick={() => act('stop')}>
              Switch off
            </Button>
          ) : (
            <Button loading={busy} onClick={() => act('start')}>
              Switch on
            </Button>
          )
        }
      >
        Photo GPU
      </SectionTitle>
      <p className="text-sm">{label}</p>
      {live && gpu.dataCenter && <p className="text-xs text-ink-400">Data centre: {gpu.dataCenter}</p>}
      {gpu.status === 'failed' && gpu.error && <p className="text-xs text-amber-300">Last start failed: {gpu.error}</p>}
      <p className="text-xs text-ink-400">
        {live && gpu.sessionUsd !== undefined ? `This session ≈ $${gpu.sessionUsd.toFixed(2)} · ` : ''}This month ${gpu.monthUsd.toFixed(2)} of ${gpu.budgetUsd.toFixed(2)}
        {gpu.rate ? ` · $${gpu.rate.toFixed(2)}/h` : ''}
      </p>
    </Card>
  );
}
