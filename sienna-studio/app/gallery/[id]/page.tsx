'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, fileUrl, useApi } from '@/lib/client/api';
import { regenerate } from '@/lib/client/jobs';
import { shareImage } from '@/lib/client/share';
import { REVIEW_INFO } from '@/lib/review';
import type { GenerationRecord, ReviewItem, ReviewMark } from '@/lib/types';
import { PROMPT_FIELD_LABELS, REVIEW_ITEMS } from '@/lib/types';
import { Badge, Button, Card, Collapsible, Notice, PageHeader, SectionTitle, Spinner, TextArea, cx, toast } from '@/components/ui';
import { GenerationMeta } from '@/components/GenerationMeta';

export default function GenerationDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: rec, setData, error } = useApi<GenerationRecord>(`/api/history/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (rec) setNotes(rec.notes);
  }, [rec?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep polling while still running (e.g. opened from a fresh tab).
  useEffect(() => {
    if (!rec || rec.status === 'done' || rec.status === 'error') return;
    const t = setInterval(() => api<GenerationRecord>(`/api/history/${id}/status`).then(setData).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [rec, id, setData]);

  if (error) return <p className="pt-20 text-center text-red-300">{error}</p>;
  if (!rec)
    return (
      <div className="flex justify-center pt-24">
        <Spinner />
      </div>
    );

  async function patch(p: Partial<GenerationRecord>) {
    try {
      setData(await api<GenerationRecord>(`/api/history/${id}`, { method: 'PATCH', json: p }));
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function rerun(newSeed: boolean) {
    setBusy(newSeed ? 'var' : 'regen');
    try {
      await regenerate(rec!, newSeed);
      router.push('/');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  function setMark(item: ReviewItem, mark: ReviewMark | null) {
    const review = { ...rec!.review };
    if (mark) review[item] = mark;
    else delete review[item];
    patch({ review });
  }

  const issues = REVIEW_ITEMS.filter((i) => rec.review[i] === 'issue');
  const date = new Date(rec.createdAt);

  return (
    <div className="pb-nav">
      <PageHeader
        title={rec.presetName ?? 'Custom'}
        subtitle={date.toLocaleString()}
        right={
          <button onClick={() => router.back()} className="min-h-[44px] px-2 text-accent">
            Back
          </button>
        }
      />

      {/* Images: horizontal swipe when there are several */}
      {rec.images.length > 0 ? (
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory overflow-x-auto">
          {rec.images.map((img, i) => (
            <div key={img.id} className="w-full shrink-0 snap-center px-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(img.file)} alt={`Generated ${i + 1}`} className="max-h-[75vh] w-full rounded-2xl bg-black object-contain" />
              {rec.images.length > 1 && <p className="mt-1 text-center text-xs text-ink-400">{i + 1} / {rec.images.length} — swipe</p>}
            </div>
          ))}
        </div>
      ) : (
        <Card className="flex aspect-[3/4] items-center justify-center">
          {rec.status === 'error' ? <Notice kind="error">{rec.error}</Notice> : <Spinner className="h-8 w-8" />}
        </Card>
      )}

      {/* Primary actions */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Button onClick={() => patch({ favorite: !rec.favorite })} className={cx(rec.favorite && 'text-accent')} aria-label="Favorite">
          {rec.favorite ? '♥' : '♡'}
        </Button>
        <Button
          variant="primary"
          className="col-span-3"
          disabled={!rec.images[0]}
          onClick={async () => {
            const img = rec.images[0];
            const r = await shareImage(fileUrl(img.file), `sienna_${rec.seed}.${img.file.split('.').pop()}`);
            if (r === 'downloaded') toast('Downloaded');
          }}
        >
          Save to Photos / Share
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button onClick={() => rerun(false)} loading={busy === 'regen'}>
          ↻ Regenerate
        </Button>
        <Button onClick={() => rerun(true)} loading={busy === 'var'}>
          🎲 New seed
        </Button>
        <Link href={`/?from=${rec.id}`}>
          <Button className="w-full">✎ Edit & regenerate</Button>
        </Link>
        <Link href={`/?init=${rec.id}`}>
          <Button className="w-full" disabled={!rec.images[0]}>
            ⇢ Use as init
          </Button>
        </Link>
      </div>
      {rec.images.length > 1 && <p className="mt-1 text-xs text-ink-400">Share saves the first image; long-press others to save.</p>}

      {/* Quality review */}
      <SectionTitle right={issues.length > 0 && <Badge tone="warn">{issues.length} issue(s)</Badge>}>Quality check</SectionTitle>
      <Card className="divide-y divide-ink-800 p-0">
        {REVIEW_ITEMS.map((item) => {
          const mark = rec.review[item];
          return (
            <div key={item} className="px-4 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px]">{REVIEW_INFO[item].label}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setMark(item, mark === 'ok' ? null : 'ok')}
                    className={cx('h-10 w-12 rounded-lg text-sm', mark === 'ok' ? 'bg-emerald-700 text-white' : 'bg-ink-800 text-ink-400')}
                  >
                    OK
                  </button>
                  <button
                    onClick={() => setMark(item, mark === 'issue' ? null : 'issue')}
                    className={cx('h-10 w-12 rounded-lg text-sm', mark === 'issue' ? 'bg-amber-600 text-white' : 'bg-ink-800 text-ink-400')}
                  >
                    ✗
                  </button>
                </div>
              </div>
              {mark === 'issue' && <p className="mt-1 text-xs text-amber-300">Fix: {REVIEW_INFO[item].fix}</p>}
            </div>
          );
        })}
      </Card>
      <TextArea
        className="mt-3"
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== rec.notes && patch({ notes })}
        placeholder="e.g. best face match so far"
      />

      {/* Metadata */}
      <SectionTitle>Details</SectionTitle>
      <GenerationMeta rec={rec} />
      {rec.parentId && (
        <Link href={`/gallery/${rec.parentId}`} className="mt-3 block text-sm text-accent">
          ← Derived from an earlier generation
        </Link>
      )}

      <div className="mt-3 space-y-3">
        <Collapsible title="Builder fields">
          <dl className="space-y-2 text-sm">
            {(Object.keys(PROMPT_FIELD_LABELS) as (keyof typeof PROMPT_FIELD_LABELS)[])
              .filter((k) => rec.fields[k])
              .map((k) => (
                <div key={k}>
                  <dt className="text-xs text-ink-400">{PROMPT_FIELD_LABELS[k]}</dt>
                  <dd>{rec.fields[k]}</dd>
                </div>
              ))}
          </dl>
        </Collapsible>
      </div>

      <Button
        variant="danger"
        className="mt-6 w-full"
        onClick={async () => {
          if (!confirm('Delete this generation and its images?')) return;
          await api(`/api/history/${rec.id}`, { method: 'DELETE' });
          router.replace('/gallery');
        }}
      >
        Delete
      </Button>
    </div>
  );
}
