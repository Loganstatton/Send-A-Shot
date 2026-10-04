'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, fileUrl } from '@/lib/client/api';
import { trackJob } from '@/lib/client/jobs';
import { shareImage } from '@/lib/client/share';
import type { GenerationRecord } from '@/lib/types';
import { GenerationMeta } from './GenerationMeta';
import { Badge, Button, Card, Notice, Spinner, toast } from './ui';

/**
 * The fixed first-real-generation test: Studio Neutral, Sienna Lock on,
 * LoRA 0.8, deterministic seed, no pose, SFW, one portrait.
 * Shows the result, every piece of metadata and any ComfyUI error.
 */
export function FirstTestCard({ workflowId, mock }: { workflowId: string | null; mock: boolean }) {
  const [job, setJob] = useState<GenerationRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<{ message: string; details?: unknown } | null>(null);

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return;
    const t = setInterval(() => api<GenerationRecord>(`/api/history/${job.id}/status`).then(setJob).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [job]);

  async function run() {
    setBusy(true);
    setRequestError(null);
    try {
      const rec = await api<GenerationRecord>('/api/diagnostics/first-test', { method: 'POST', json: { workflowId } });
      trackJob(rec.id);
      // fetch the full record (includes the submitted graph)
      setJob(await api<GenerationRecord>(`/api/history/${rec.id}`));
    } catch (e: any) {
      setRequestError({ message: e.message, details: e.details });
    } finally {
      setBusy(false);
    }
  }

  const elapsed = job ? Math.round(((job.completedAt ? Date.parse(job.completedAt) : Date.now()) - Date.parse(job.createdAt)) / 1000) : 0;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold">First real Sienna generation</p>
        {mock && <Badge tone="warn">MOCK</Badge>}
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-400">
        <li>Preset: Studio Neutral · Sienna Lock ON · SFW</li>
        <li>LoRA strength 0.8 · fixed seed (re-runs give the same image)</li>
        <li>No pose, no img2img · one 896×1152 portrait</li>
        <li>Face reference used if uploaded and the identity nodes are installed</li>
      </ul>
      {mock && <Notice kind="warn">The app is in MOCK MODE: this runs end-to-end but produces a placeholder. Connect ComfyUI in Settings first.</Notice>}
      <Button variant="primary" className="h-12 w-full" loading={busy} onClick={run}>
        {job ? 'Run the test again' : 'Run first generation test'}
      </Button>

      {requestError && (
        <Notice kind="error">
          <p className="font-medium">Request failed</p>
          <p className="mt-1 break-words">{requestError.message}</p>
          {requestError.details != null && (
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify(requestError.details, null, 2)}</pre>
          )}
        </Notice>
      )}

      {job && (
        <div className="space-y-3">
          {job.status === 'done' && job.images[0] ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(job.images[0].file)} alt="First test result" className="w-full rounded-xl bg-black" />
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => shareImage(fileUrl(job.images[0].file), `sienna_test_${job.seed}.png`).then((r) => r === 'downloaded' && toast('Downloaded'))}>
                  Save / Share
                </Button>
                <Link href={`/gallery/${job.id}`}>
                  <Button className="w-full">Review in gallery</Button>
                </Link>
              </div>
            </>
          ) : job.status !== 'error' ? (
            <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-xl bg-ink-800 text-center text-sm text-ink-400">
              <Spinner className="h-8 w-8" />
              {job.status === 'queued' ? `Queued${job.queuePosition ? ` · #${job.queuePosition}` : ''}` : 'Generating…'} · {elapsed}s
              <span className="px-6 text-xs">A cold GPU loads models first — the first run can take a few minutes.</span>
            </div>
          ) : null}
          <GenerationMeta rec={job} />
        </div>
      )}
    </Card>
  );
}
