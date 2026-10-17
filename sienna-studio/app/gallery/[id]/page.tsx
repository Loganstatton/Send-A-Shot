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
import { rerunVideo, shareVideo } from '@/lib/client/video';
import { MOVEMENT_LABELS } from '@/lib/video-framing';
import { CAMERA_LABELS, VIDEO_MODE_LABELS } from '@/lib/video';
import { REVIEW_INFO } from '@/lib/review';
import type { GenerationRecord, ReviewItem, ReviewMark } from '@/lib/types';
import { PROMPT_FIELD_LABELS, REVIEW_ITEMS } from '@/lib/types';
import { Badge, Button, Card, Chip, Collapsible, Notice, PageHeader, SectionTitle, Spinner, TextArea, cx, toast } from '@/components/ui';
import { GenerationMeta } from '@/components/GenerationMeta';
import { identityNotice, isLegacyPhoto, LEGACY_NOTICE } from '@/lib/identity-notice';

export default function GenerationDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: rec, setData, error } = useApi<GenerationRecord>(`/api/history/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const { data: editAvail } = useApi<OutfitEditAvailability>('/api/outfit-edit');
  const [showBefore, setShowBefore] = useState(false);
  // Lock Camera: show the stabilized copy when there is one, until the user switches back to the natural camera
  const [naturalCamera, setNaturalCamera] = useState(false);
  const { data: settings } = useApi<{ env: { experiments?: boolean; video?: boolean } }>('/api/settings');
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
      if (rec!.video) {
        const next = await rerunVideo(rec!, newSeed);
        router.push(`/gallery/${next.id}`);
        return;
      }
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
  const shownVideo = rec.video ? ((!naturalCamera && rec.video.lockCamera?.result) || rec.video.result || null) : null;

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

      {(rec.outfitEdit || rec.video) && rec.images.length > 0 && (
        <div className="mb-2 flex gap-2">
          <Chip active={!showBefore} onClick={() => setShowBefore(false)}>
            {rec.video ? 'Video' : 'After'}
          </Chip>
          <Chip active={showBefore} onClick={() => setShowBefore(true)}>
            {rec.video ? 'Photo' : 'Before'}
          </Chip>
        </div>
      )}
      {rec.video?.lockCamera?.result && !showBefore && (
        <div className="mb-2 grid grid-cols-2 gap-2" role="group" aria-label="Camera">
          <Chip active={naturalCamera} onClick={() => setNaturalCamera(true)} className="w-full">
            Natural camera
          </Chip>
          <Chip active={!naturalCamera} onClick={() => setNaturalCamera(false)} className="w-full">
            🔒 Locked camera
          </Chip>
        </div>
      )}
      {/* Images: horizontal swipe when there are several */}
      {rec.video && showBefore ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl(rec.video.sourceImage.file)} alt="The photo the video was made from" className="max-h-[75vh] w-full rounded-2xl bg-black object-contain" />
      ) : shownVideo ? (
        <video
          key={shownVideo.file}
          src={fileUrl(shownVideo.file)}
          poster={rec.images[0] ? fileUrl(rec.images[0].file) : undefined}
          controls
          autoPlay
          muted
          loop
          playsInline
          className="max-h-[75vh] w-full rounded-2xl bg-black object-contain"
        />
      ) : rec.video ? (
        <Card className="flex aspect-[3/4] flex-col items-center justify-center gap-3 text-center text-sm text-ink-400">
          {rec.status === 'error' ? (
            <Notice kind="error">{rec.error}</Notice>
          ) : (
            <>
              <Spinner className="h-8 w-8" />
              {rec.video.gpu?.phase === 'starting' ? (
                <span>
                  Starting the video GPU{rec.video.gpu.waitingFor ? ` — ${rec.video.gpu.waitingFor}` : ''}…
                  <br />
                  usually 8–12 min, then about {rec.video.estimateMinutes} min for the video — you can leave this page
                </span>
              ) : (
                <span>
                  {rec.status === 'queued' ? (rec.queuePosition ? `Queued · #${rec.queuePosition}` : 'Queued') : 'Making the video…'}
                  <br />
                  usually about {rec.video.estimateMinutes} min — you can leave this page
                </span>
              )}
            </>
          )}
        </Card>
      ) : rec.outfitEdit && showBefore ? (
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

      <IdentityReview rec={rec} onMark={(mark) => setMark('face_drift', mark)} />

      {/* Primary actions */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Button onClick={() => patch({ favorite: !rec.favorite })} className={cx(rec.favorite && 'text-accent')} aria-label="Favorite">
          {rec.favorite ? '♥' : '♡'}
        </Button>
        <Button
          variant="primary"
          className="col-span-3"
          disabled={rec.video ? !shownVideo : !rec.images[0]}
          onClick={async () => {
            if (shownVideo) {
              const r = await shareVideo(fileUrl(shownVideo.file), `sienna_${rec.seed}${shownVideo === rec.video?.lockCamera?.result ? '_locked' : ''}.mp4`);
              if (r === 'downloaded') toast('Downloaded');
              return;
            }
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
          {rec.video ? '↻ Make again' : rec.outfitEdit ? '↻ Re-run edit' : '↻ Regenerate'}
        </Button>
        <Button onClick={() => rerun(true)} loading={busy === 'var'}>
          🎲 New seed
        </Button>
        {settings?.env.video && !rec.video && rec.images[0] && (
          <>
            <Link href={`/video?photo=${rec.id}`}>
              <Button className="w-full">🎬 Animate</Button>
            </Link>
            <Link href={`/video?mode=motion&photo=${rec.id}`}>
              <Button className="w-full">🕺 Copy motion</Button>
            </Link>
          </>
        )}
        {editAvail?.enabled && !rec.video && (
          <Link href={`/gallery/${rec.id}/edit-outfit`} className="col-span-2">
            <Button className="w-full" disabled={!rec.images[0]}>
              👗 Edit outfit
            </Button>
          </Link>
        )}
        {experiments && rec.images[0] && !rec.video && <BodyRefButton rec={rec} refs={bodyRefs} onChange={setBodyRefs} />}
        {!rec.outfitEdit && !rec.video && (
          <Link href={`/?from=${rec.id}`}>
            <Button className="w-full">✎ Edit & regenerate</Button>
          </Link>
        )}
        {!rec.video && (
          <Link href={`/?init=${rec.id}`}>
            <Button className="w-full" disabled={!rec.images[0]}>
              ⇢ Use as init
            </Button>
          </Link>
        )}
      </div>
      {rec.images.length > 1 && <p className="mt-1 text-xs text-ink-400">Share saves the first image; long-press others to save.</p>}

      {rec.outfitEdit && <OutfitEditCard rec={rec} />}
      {rec.video && <VideoCard rec={rec} />}

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
              {rec.video ? '← The photo it was made from' : rec.outfitEdit ? '← Original image' : '← Derived from an earlier generation'}
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
          if (!confirm(rec.video ? 'Delete this video?' : 'Delete this generation and its images?')) return;
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
    ...(e.redraw?.preview ? ([['Area redrawn', e.redraw.preview]] as [string, { file: string }][]) : []),
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
        {e.redraw && (
          <>
            <dt className="text-ink-400">Changed</dt>
            <dd>
              only the clothes
              {e.redraw.info && (
                <span className="block text-xs text-ink-400">
                  {Math.round(e.redraw.info.mask * 100)}% of the image redrawn{e.redraw.info.source === 'pose' ? ' (area estimated from her pose)' : ''}
                </span>
              )}
            </dd>
          </>
        )}
        {e.avoid && (
          <>
            <dt className="text-ink-400">Avoid</dt>
            <dd className="text-xs">{e.avoid}</dd>
          </>
        )}
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

function LockCameraSummary({ lc }: { lc: NonNullable<NonNullable<GenerationRecord['video']>['lockCamera']> }) {
  const r = lc.report;
  if (lc.status === 'on') return <>on — runs after the video is made</>;
  if (lc.status === 'applied')
    return (
      <>
        ✓ applied — both versions kept (switch above the video)
        {r?.before && r.after ? (
          <span className="block text-ink-400">
            Background drift {r.before.maxPx} px → {r.after.maxPx} px
            {r.fillPct ? ` · edges filled ${r.fillPct}%` : ''}
            {r.sharpness ? ` · sharpness ${Math.round(r.sharpness * 100)}%` : ''}
          </span>
        ) : null}
      </>
    );
  if (lc.status === 'steady') return <>not needed — the camera was already steady{r?.before ? ` (${r.before.maxPx} px)` : ''}</>;
  return <span className="text-amber-300">not applied — {lc.reason ?? 'unknown'}; the natural camera video is kept</span>;
}

function VideoCard({ rec }: { rec: GenerationRecord }) {
  const v = rec.video!;
  const faces = v.frameFaces ?? [];
  return (
    <Card className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">{VIDEO_MODE_LABELS[v.mode]}</p>
        <Link href={`/gallery/${v.sourceId}`} className="text-sm text-accent">
          Open photo →
        </Link>
      </div>
      {v.drive && (
        <div className="flex items-center gap-3 text-xs text-ink-400">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl(v.drive.poster.file)} alt="Movement video" className="h-24 w-[72px] rounded-lg bg-black object-cover" />
          <span>
            Movement copied from {v.drive.start > 0 ? `${v.drive.start} s` : 'the start'} of the video, {v.drive.seconds} s
            {v.chunks && v.chunks > 1 ? ` (made in ${v.chunks} parts)` : ''}.
          </span>
        </div>
      )}
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-400">Model</dt>
        <dd>{v.model === 'wan2.2-i2v-14b' ? 'Wan2.2 image-to-video 14B' : v.model === 'wan2.2-animate-2-14b' ? 'Wan2.2-Animate-2 14B' : 'Wan2.2 Animate 14B'}</dd>
        <dt className="text-ink-400">Length</dt>
        <dd>
          {v.result ? `${v.result.seconds} s · ${v.result.frames} frames` : `${v.seconds} s`} at 16 fps
        </dd>
        <dt className="text-ink-400">Size</dt>
        <dd>
          {v.width}×{v.height} ({v.resolution}){v.mode === 'animate' ? ` · ${v.quality === 'fast' ? 'fast, 4 steps' : v.quality === 'hybrid' ? 'hybrid (testing)' : 'quality, 20 steps'}` : ''}
        </dd>
        {v.safeFraming && (
          <>
            <dt className="text-ink-400">Safe framing</dt>
            <dd className="text-xs">
              {MOVEMENT_LABELS[v.safeFraming.movement]}
              {v.safeFraming.report?.plan
                ? v.safeFraming.report.plan.changed
                  ? ` · room added: ${(['top', 'bottom', 'left', 'right'] as const)
                      .filter((k) => v.safeFraming!.report!.plan![k] > 0)
                      .map((k) => `${k} ${v.safeFraming!.report!.plan![k]} px`)
                      .join(', ')}`
                  : ' · the photo already had enough room'
                : v.safeFraming.report && !v.safeFraming.report.available
                  ? ` · not applied (${v.safeFraming.report.error ?? 'unknown'})`
                  : ''}
              {v.safeFraming.framedImage && (
                <a className="ml-2 text-accent" href={fileUrl(v.safeFraming.framedImage.file)} target="_blank" rel="noreferrer">
                  framed photo →
                </a>
              )}
            </dd>
          </>
        )}
        {v.gpu?.cost && (
          <>
            <dt className="text-ink-400">GPU cost</dt>
            <dd className="text-xs">
              ≈ ${v.gpu.cost.usd.toFixed(3)} · {Math.round(v.gpu.cost.gpuSeconds / 6) / 10} min on {v.gpu.cost.gpu.replace(/^NVIDIA (GeForce )?/, '')}
              {v.gpu.cost.startupUsd > 0 ? ` (incl. $${v.gpu.cost.startupUsd.toFixed(3)} to start the GPU)` : ''}
            </dd>
          </>
        )}
        {v.lockCamera && (
          <>
            <dt className="text-ink-400">Lock Camera</dt>
            <dd className="text-xs">
              <LockCameraSummary lc={v.lockCamera} />
            </dd>
          </>
        )}
        {v.motion !== undefined && (
          <>
            <dt className="text-ink-400">Motion</dt>
            <dd className="break-words">{v.motion || '—'}</dd>
          </>
        )}
        {v.camera && (
          <>
            <dt className="text-ink-400">Camera</dt>
            <dd>{CAMERA_LABELS[v.camera].label}</dd>
          </>
        )}
        {v.scene !== undefined && v.mode === 'motion' && (
          <>
            <dt className="text-ink-400">Scene</dt>
            <dd className="break-words">{v.scene || '—'}</dd>
          </>
        )}
        <dt className="text-ink-400">Face check</dt>
        <dd>
          {v.faceCheck.status === 'unavailable' ? (
            <span className="text-amber-300">not run — {v.faceCheck.reason}</span>
          ) : faces.length ? (
            <span className="text-xs">
              {faces.map((f, i) => (
                <span key={i} className={`mr-2 inline-block ${f.found && (f.similarity ?? 0) >= 0.74 ? 'text-emerald-300' : 'text-amber-300'}`}>
                  frame {i + 1}: {f.found && f.similarity !== null ? f.similarity.toFixed(2) : 'no face'}
                </span>
              ))}
            </span>
          ) : rec.status === 'done' ? (
            'no result'
          ) : (
            'pending'
          )}
        </dd>
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

/** Shown when the face wasn't verified as Sienna's: the user decides whether the photo looks like her. */
function IdentityReview({ rec, onMark }: { rec: GenerationRecord; onMark: (mark: 'ok' | 'issue' | null) => void }) {
  const mark = rec.review?.face_drift;
  const n = isLegacyPhoto(rec)
    ? { ...LEGACY_NOTICE, userCall: mark === 'ok' ? ('looks_like_her' as const) : mark === 'issue' ? ('not_her' as const) : undefined }
    : identityNotice(rec);
  if (!n) return null;
  return (
    <Notice kind="warn">
      <p className="font-medium">{n.title}</p>
      <p className="mt-1">{n.detail}</p>
      {n.userCall ? (
        <p className="mt-2 text-xs">
          {n.userCall === 'looks_like_her'
            ? 'You approved it: it is in the gallery as your approval. The face check still did not verify it.'
            : 'You marked it: not Sienna. It stays in Needs Review — delete it if you do not want it.'}{' '}
          <button className="text-accent underline" onClick={() => onMark(null)}>
            Undo
          </button>
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button onClick={() => onMark('ok')}>Looks like Sienna — approve</Button>
          <Button onClick={() => onMark('issue')}>Not her</Button>
        </div>
      )}
    </Notice>
  );
}
