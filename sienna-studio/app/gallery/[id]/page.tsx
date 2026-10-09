'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, fileUrl, useApi } from '@/lib/client/api';
import { regenerate } from '@/lib/client/jobs';
import { OutfitEditAvailability, rerunOutfitEdit } from '@/lib/client/outfit-edit';
import { FACE_LABELS, FOOTWEAR_LABELS, PROTECT_LABELS, SCOPE_LABELS } from '@/lib/outfit-edit';
import { bodyReferenceProblem, BodyReference } from '@/lib/body-refs';
import { shareImage } from '@/lib/client/share';
import { REVIEW_INFO } from '@/lib/review';
import type { GenerationRecord, ReviewItem, ReviewMark } from '@/lib/types';
import { PROMPT_FIELD_LABELS, REVIEW_ITEMS } from '@/lib/types';
import { Badge, Button, Card, Chip, Collapsible, Notice, PageHeader, SectionTitle, Spinner, TextArea, cx, toast } from '@/components/ui';
import { GenerationMeta } from '@/components/GenerationMeta';

export default function GenerationDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: rec, setData, error } = useApi<GenerationRecord>(`/api/history/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const { data: editAvail } = useApi<OutfitEditAvailability>('/api/outfit-edit');
  const [showBefore, setShowBefore] = useState(false);
  const { data: settings } = useApi<{ env: { experiments?: boolean } }>('/api/settings');
  const experiments = !!settings?.env.experiments;
  const { data: bodyRefs, setData: setBodyRefs } = useApi<BodyReference[]>(experiments ? '/api/character/body-references' : null);

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
      if (rec!.outfitEdit) {
        const next = await rerunOutfitEdit(rec!, newSeed);
        router.push(`/gallery/${next.id}`);
        return;
      }
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

      {rec.outfitEdit && rec.images.length > 0 && (
        <div className="mb-2 flex gap-2">
          <Chip active={!showBefore} onClick={() => setShowBefore(false)}>
            After
          </Chip>
          <Chip active={showBefore} onClick={() => setShowBefore(true)}>
            Before
          </Chip>
        </div>
      )}
      {/* Images: horizontal swipe when there are several */}
      {rec.outfitEdit && showBefore ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl(rec.outfitEdit.sourceImage.file)} alt="Before the edit" className="max-h-[75vh] w-full rounded-2xl bg-black object-contain" />
      ) : rec.images.length > 0 ? (
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
          {rec.outfitEdit ? '↻ Re-run edit' : '↻ Regenerate'}
        </Button>
        <Button onClick={() => rerun(true)} loading={busy === 'var'}>
          🎲 New seed
        </Button>
        {editAvail?.enabled && (
          <Link href={`/gallery/${rec.id}/edit-outfit`} className="col-span-2">
            <Button className="w-full" disabled={!rec.images[0]}>
              👗 Edit outfit
            </Button>
          </Link>
        )}
        {experiments && rec.images[0] && <BodyRefButton rec={rec} refs={bodyRefs} onChange={setBodyRefs} />}
        {!rec.outfitEdit && (
          <Link href={`/?from=${rec.id}`}>
            <Button className="w-full">✎ Edit & regenerate</Button>
          </Link>
        )}
        <Link href={`/?init=${rec.id}`}>
          <Button className="w-full" disabled={!rec.images[0]}>
            ⇢ Use as init
          </Button>
        </Link>
      </div>
      {rec.images.length > 1 && <p className="mt-1 text-xs text-ink-400">Share saves the first image; long-press others to save.</p>}

      {rec.outfitEdit && <OutfitEditCard rec={rec} />}

      <div className="mt-5 space-y-3">
        {/* Quality review */}
        <Collapsible
          title="Quality check & notes"
          defaultOpen={issues.length > 0 || !!rec.notes}
          badge={issues.length > 0 ? <Badge tone="warn">{issues.length} issue(s)</Badge> : rec.notes ? <Badge>note</Badge> : null}
        >
          <div className="-mx-4 divide-y divide-ink-800">
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
          </div>
          <TextArea
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== rec.notes && patch({ notes })}
            placeholder="e.g. best face match so far"
          />
        </Collapsible>

        {/* Metadata */}
        <Collapsible title="Generation details">
          <GenerationMeta rec={rec} />
          {rec.parentId && (
            <Link href={`/gallery/${rec.parentId}`} className="block text-sm text-accent">
              {rec.outfitEdit ? '← Original image' : '← Derived from an earlier generation'}
            </Link>
          )}
        </Collapsible>
      </div>

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

function OutfitEditCard({ rec }: { rec: GenerationRecord }) {
  const e = rec.outfitEdit!;
  const thumbs: [string, { file: string } | null | undefined][] = [
    ['Original', e.sourceImage],
    ['Clothing photo', e.reference],
    [e.manualCrop ? 'Cropped by hand' : 'As the editor saw it', e.manualCrop ? e.reference : e.referenceCrop],
  ];
  return (
    <Card className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">Outfit edit</p>
        <Link href={`/gallery/${e.sourceId}`} className="text-sm text-accent">
          Open original →
        </Link>
      </div>
      <div className="flex gap-3">
        {thumbs.map(([label, img]) =>
          img ? (
            <div key={label} className="text-center text-[11px] text-ink-400">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(img.file)} alt={label} className="mb-1 h-24 w-[72px] rounded-lg bg-black object-cover" />
              {label}
            </div>
          ) : null,
        )}
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-400">Replaced</dt>
        <dd>{SCOPE_LABELS[e.scope]}</dd>
        <dt className="text-ink-400">Footwear</dt>
        <dd>{FOOTWEAR_LABELS[e.footwear]}</dd>
        <dt className="text-ink-400">Face restore</dt>
        <dd>{FACE_LABELS[e.face]}</dd>
        <dt className="text-ink-400">Crop</dt>
        <dd>
          {e.manualCrop
            ? 'by hand'
            : e.crop
              ? e.crop.mode === 'cropped'
                ? `below the chin (top ${Math.round(e.crop.cut * 100)}% removed)`
                : e.crop.mode === 'no-face'
                  ? 'no face found — uncropped'
                  : 'face too low — uncropped'
              : rec.status === 'done'
                ? '—'
                : 'pending'}
        </dd>
        {e.protect && (
          <>
            <dt className="text-ink-400">Body protection</dt>
            <dd>
              {(Object.keys(PROTECT_LABELS) as (keyof typeof PROTECT_LABELS)[])
                .filter((k) => e.protect![k])
                .map((k) => PROTECT_LABELS[k].label)
                .join(' · ') || 'none'}
              {e.isolation && <span className="block text-xs text-ink-400">Clothing only: {e.isolation.mode === 'garment-only' ? 'applied' : `fell back to chin crop (${e.isolation.reason})`}</span>}
            </dd>
          </>
        )}
        {e.bodyCheck && (
          <>
            <dt className="text-ink-400">Body check</dt>
            <dd>
              <Badge tone={e.bodyCheck.status === 'ok' ? 'ok' : e.bodyCheck.status === 'warn' ? 'warn' : 'neutral'}>
                {e.bodyCheck.status === 'ok' ? 'consistent' : e.bodyCheck.status === 'warn' ? 'possible change' : 'not enough to compare'}
              </Badge>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-400">
                {e.bodyCheck.checked.map((c) => (
                  <li key={c.part} className={e.bodyCheck!.flags.some((f) => f.part === c.part) ? 'text-amber-300' : ''}>
                    {c.part}: {c.change === 0 ? 'within range' : `${c.change > 0 ? '+' : '−'}${Math.round(Math.abs(c.change) * 100)}%`} ({c.basis === 'source' ? 'vs original' : c.basis})
                  </li>
                ))}
                {[...new Set(e.bodyCheck.skipped.map((x) => x.why))].map((w) => (
                  <li key={w}>not checked: {w}</li>
                ))}
                {e.bodyCheck.scene && <li>background change: {e.bodyCheck.scene.diff}{e.bodyCheck.scene.changed ? ' — scene replaced' : ''}</li>}
              </ul>
            </dd>
          </>
        )}
        <dt className="text-ink-400">Description</dt>
        <dd className="break-words">{e.description}</dd>
        <dt className="text-ink-400">Was wearing</dt>
        <dd className="break-words text-ink-400">{e.originalOutfit || '—'}</dd>
      </dl>
    </Card>
  );
}

function BodyRefButton({ rec, refs, onChange }: { rec: GenerationRecord; refs?: BodyReference[]; onChange: (r: BodyReference[]) => void }) {
  const [busy, setBusy] = useState(false);
  const imageId = rec.images[0]?.id;
  const isRef = !!refs?.some((r) => r.image.id === imageId);
  const problem = bodyReferenceProblem(rec, 0);
  async function toggle() {
    setBusy(true);
    try {
      onChange(
        isRef
          ? await api<BodyReference[]>(`/api/character/body-references?imageId=${encodeURIComponent(imageId)}`, { method: 'DELETE' })
          : await api<BodyReference[]>('/api/character/body-references', { method: 'POST', json: { recordId: rec.id, imageIndex: 0 } }),
      );
      toast(isRef ? 'Removed from body references' : 'Added to Sienna’s body references');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="col-span-2">
      <Button className="w-full" loading={busy} disabled={!isRef && !!problem} onClick={toggle}>
        {isRef ? '✓ Body reference · remove' : '＋ Use as body reference'}
      </Button>
      {!isRef && problem && <p className="mt-1 text-xs text-ink-400">Not eligible as a body reference: {problem}.</p>}
    </div>
  );
}
