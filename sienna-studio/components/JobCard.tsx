'use client';

import Link from 'next/link';
import { fileUrl } from '@/lib/client/api';
import { shareImage } from '@/lib/client/share';
import type { GenerationRecord } from '@/lib/types';
import { Badge, Button, Card, Notice, Spinner, toast } from './ui';

export function JobCard({ job, onDismiss }: { job: GenerationRecord; onDismiss: () => void }) {
  const img = job.images[0];
  const elapsed = Math.round(((job.completedAt ? Date.parse(job.completedAt) : Date.now()) - Date.parse(job.createdAt)) / 1000);

  return (
    <Card className="overflow-hidden p-0">
      {job.status === 'done' && img ? (
        <Link href={`/gallery/${job.id}`} className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl(img.file)} alt="Generated" className="max-h-[70vh] w-full bg-black object-contain" />
        </Link>
      ) : (
        <div className="flex aspect-[3/4] max-h-[50vh] w-full flex-col items-center justify-center gap-3 bg-ink-800 text-sm text-ink-400">
          {job.status === 'error' ? (
            <span className="px-6 text-center text-red-300">Failed</span>
          ) : (
            <>
              <Spinner className="h-8 w-8" />
              <span>
                {job.status === 'queued' ? (job.queuePosition ? `Queued · #${job.queuePosition}` : 'Queued') : 'Generating…'} · {elapsed}s
              </span>
            </>
          )}
        </div>
      )}
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2 text-xs text-ink-400">
          <Badge tone={job.status === 'done' ? 'ok' : job.status === 'error' ? 'error' : 'accent'}>{job.status}</Badge>
          <span className="truncate">
            {job.presetName ?? 'Custom'} · seed {job.seed}
          </span>
          {job.images.length > 1 && <span>· {job.images.length} images</span>}
        </div>
        {job.error && <Notice kind="error">{job.error}</Notice>}
        {job.warnings.slice(0, 2).map((w, i) => (
          <p key={i} className="text-xs text-amber-300">
            {w}
          </p>
        ))}
        <div className="flex gap-2">
          {job.status === 'done' && img && (
            <>
              <Button
                variant="primary"
                className="flex-1"
                onClick={async () => {
                  const r = await shareImage(fileUrl(img.file), `sienna_${job.seed}.png`);
                  if (r === 'downloaded') toast('Downloaded');
                }}
              >
                Save / Share
              </Button>
              <Link href={`/gallery/${job.id}`} className="flex-1">
                <Button className="w-full">Details</Button>
              </Link>
            </>
          )}
          <Button variant="ghost" onClick={onDismiss} aria-label="Dismiss">
            ✕
          </Button>
        </div>
      </div>
    </Card>
  );
}
