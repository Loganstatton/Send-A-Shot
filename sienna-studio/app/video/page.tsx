'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { fileUrl, useApi } from '@/lib/client/api';
import { DrivingVideo, startVideo, uploadDrivingVideo, VideoAvailability } from '@/lib/client/video';
import { galleryState } from '@/lib/identity-notice';
import type { GenerationRecord } from '@/lib/types';
import {
  CAMERA_LABELS,
  CameraMove,
  DURATIONS_ANIMATE,
  estimateMinutes,
  lockCameraAllowed,
  MAX_MOTION_SECONDS,
  MAX_MOTION_TEXT,
  MOTION_PRESETS,
  MotionPreset,
  motion2Chunks,
  motionChunks,
  VIDEO_FPS,
  VideoMode,
  VideoQuality,
  VideoResolution,
  slowMotionWords,
  videoSize,
} from '@/lib/video';
import { MOVEMENT_LABELS, MovementKind, movementFromText, SAFE_FRAMING_DEFAULT } from '@/lib/video-framing';
import { Badge, Button, Card, Chip, Collapsible, Notice, PageHeader, SectionTitle, Slider, Spinner, TextArea, TextInput, toast } from '@/components/ui';

export default function VideoPage() {
  return (
    <Suspense fallback={null}>
      <VideoStudio />
    </Suspense>
  );
}

function VideoStudio() {
  const router = useRouter();
  const search = useSearchParams();
  const { data: avail, error: availError } = useApi<VideoAvailability>('/api/video');
  const { data: history } = useApi<GenerationRecord[]>('/api/history?limit=500');

  const [mode, setMode] = useState<VideoMode>(search.get('mode') === 'motion' ? 'motion' : 'animate');
  const [photoId, setPhotoId] = useState<string | null>(search.get('photo'));
  const [picking, setPicking] = useState(false);
  // Animate Image
  const [motion, setMotion] = useState(MOTION_PRESETS[0].text);
  const [presetId, setPresetId] = useState<string | null>(MOTION_PRESETS[0].id);
  const [camera, setCamera] = useState<CameraMove>('still');
  const [seconds, setSeconds] = useState(5);
  const [quality, setQuality] = useState<VideoQuality>('fast');
  // Copy Motion
  const [drive, setDrive] = useState<DrivingVideo | null>(null);
  const [upload, setUpload] = useState<number | null>(null);
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(5);
  const [scene, setScene] = useState('');
  const [motionMovement, setMotionMovement] = useState<MovementKind>('small');
  // Safe framing: on/off follows the movement until the user chooses
  const [framingChoice, setFramingChoice] = useState<boolean | null>(null);
  // Lock Camera: off (natural camera) unless the user picks it
  const [lockCamera, setLockCamera] = useState(false);
  // both
  const [resolution, setResolution] = useState<VideoResolution>('480p');
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Photos that can be animated: finished, not videos. Approved ones first.
  const photos = useMemo(
    () =>
      (history ?? [])
        .filter((r) => r.status === 'done' && r.images[0] && !r.video)
        .sort((a, b) => Number(galleryState(b) === 'approved') - Number(galleryState(a) === 'approved')),
    [history],
  );
  const photo = photos.find((r) => r.id === photoId) ?? null;
  useEffect(() => {
    if (!photoId && photos.length) setPhotoId(photos[0].id);
  }, [photos, photoId]);

  const preset: MotionPreset | null = MOTION_PRESETS.find((p) => p.id === presetId && p.text === motion) ?? null;
  const movement: MovementKind = mode === 'animate' ? preset?.framing ?? movementFromText(motion) : motionMovement;
  useEffect(() => setFramingChoice(null), [movement]);
  const framing = framingChoice ?? SAFE_FRAMING_DEFAULT[movement];
  const slow = mode === 'animate' ? slowMotionWords(motion) : [];

  const img = photo?.images[0];
  const size = videoSize(img?.width ?? photo?.params.width ?? 832, img?.height ?? photo?.params.height ?? 1216, resolution);
  const driveSeconds = drive?.video.seconds ?? 0;
  const maxStart = Math.max(0, Math.floor((driveSeconds - 1) * 2) / 2);
  const maxLength = Math.max(1, Math.min(MAX_MOTION_SECONDS, Math.floor((driveSeconds - start) * 2) / 2));
  useEffect(() => {
    if (length > maxLength) setLength(maxLength);
  }, [maxLength, length]);
  const chunks = (avail?.motionEngine === 'animate1' ? motionChunks : motion2Chunks)(Math.round(length * VIDEO_FPS));
  const minutes =
    mode === 'animate'
      ? estimateMinutes({ mode, quality, ...size, frames: seconds * VIDEO_FPS + 1 })
      : estimateMinutes({ mode, quality: 'fast', ...size, frames: chunks.frames, chunks: chunks.chunks });

  async function pickVideo(f: File | undefined) {
    if (!f) return;
    setUpload(0);
    try {
      const d = await uploadDrivingVideo(f, (p) => setUpload(p));
      setDrive(d);
      setStart(0);
      setLength(Math.min(MAX_MOTION_SECONDS, Math.max(1, Math.floor(d.video.seconds * 2) / 2)));
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setUpload(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function run() {
    if (!photo) return;
    setBusy(true);
    try {
      const seedNum = seed.trim() === '' ? -1 : Math.max(0, Math.floor(Number(seed)) || 0);
      const rec = await startVideo(
        mode === 'animate'
          ? { mode, sourceId: photo.id, seed: seedNum, quality, resolution, motion, camera, seconds, framing: framingUsable && framing ? movement : null, lockCamera: lockUsable && lockCamera }
          : { mode, sourceId: photo.id, seed: seedNum, quality: 'fast', resolution, drive: drive!, start, seconds: length, scene, framing: framingUsable && framing ? movement : null, lockCamera: lockUsable && lockCamera },
      );
      toast(rec.status === 'error' ? 'Video failed — see details' : 'Video queued');
      router.push(`/gallery/${rec.id}`);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (availError) return <p className="pt-20 text-center text-red-300">{availError}</p>;
  if (!avail)
    return (
      <div className="flex justify-center pt-24">
        <Spinner />
      </div>
    );
  if (!avail.enabled)
    return (
      <div className="pb-nav">
        <PageHeader title="Video Studio" />
        <Notice>Video Studio is turned off on this server. Set SIENNA_VIDEO=true to enable it.</Notice>
      </div>
    );

  const m = avail.modes[mode];
  const framingUsable = avail.safeFraming.available && movement !== 'still' && (mode === 'animate' || avail.motionEngine === 'animate2');
  const lockAllowed = lockCameraAllowed(mode, camera);
  const lockUsable = avail.lockCamera.available && lockAllowed;
  const engine =
    mode === 'animate'
      ? `Wan2.2 Animate Image (I2V 14B) · ${quality === 'fast' ? 'Fast, 4 steps' : quality === 'quality' ? 'Quality, 20 steps (testing)' : 'Hybrid (testing)'}`
      : avail.motionEngine === 'animate2'
        ? 'Wan2.2-Animate-2 Copy Motion · 6 steps'
        : 'Wan2.2 Animate Copy Motion (v1, DWPose)';
  const canRun = m.available && !!photo && !busy && (mode === 'animate' ? motion.trim().length > 0 : !!drive && upload === null);

  return (
    <div className="pb-nav">
      <PageHeader title="Video Studio" subtitle="Wan2.2 · Sienna in motion" />
      {avail.backend === 'mock' && (
        <Notice kind="warn">
          Test mode (no GPU connected): videos are a slow zoom over the photo, made on this server. Nothing is generated and nothing costs money.
        </Notice>
      )}

      <div className="my-3 grid grid-cols-2 gap-2">
        <Chip active={mode === 'animate'} onClick={() => setMode('animate')} className="w-full">
          🎬 Animate Image
        </Chip>
        <Chip active={mode === 'motion'} onClick={() => setMode('motion')} className="w-full">
          🕺 Copy Motion
        </Chip>
      </div>
      <p className="mb-3 text-sm text-ink-400">
        {mode === 'animate'
          ? 'Brings a photo of Sienna to life: describe what she does and how the camera moves.'
          : 'Sienna performs the movement from a short video — a dance, a walk, a pose sequence. Only Sienna appears in the result.'}
      </p>
      {!m.available && (
        <Notice kind="warn">
          <p className="font-medium">Not available on the GPU server yet</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {m.missing.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="mt-4 space-y-4">
        <Card className="space-y-3">
          <SectionTitle right={<button className="min-h-[44px] text-sm text-accent" onClick={() => setPicking((p) => !p)}>{picking ? 'Done' : 'Change'}</button>}>
            Sienna photo
          </SectionTitle>
          {photo && img ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(img.file)} alt="" className="h-28 w-20 rounded-lg bg-black object-cover" />
              <div className="min-w-0 text-sm">
                <p className="truncate">{photo.presetName ?? 'Custom'}</p>
                <PhotoBadge rec={photo} />
                <p className="mt-1 text-xs text-ink-400">
                  Video: {size.width}×{size.height}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-400">{history ? 'No finished photos yet — create one first.' : 'Loading photos…'}</p>
          )}
          {picking && (
            <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto">
              {photos.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setPhotoId(r.id);
                    setPicking(false);
                  }}
                  className={`relative aspect-[3/4] overflow-hidden rounded-lg bg-ink-800 ${r.id === photoId ? 'ring-2 ring-accent' : ''}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(r.images[0].file)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {galleryState(r) !== 'approved' && <span className="absolute inset-x-0 bottom-0 bg-black/70 text-[10px] text-amber-300">not verified</span>}
                </button>
              ))}
            </div>
          )}
          {photo && galleryState(photo) !== 'approved' && (
            <p className="text-xs text-amber-300">This photo’s face wasn’t verified as Sienna’s. A verified photo gives the video the best chance of passing the face check.</p>
          )}
        </Card>

        {mode === 'animate' ? (
          <Card className="space-y-3">
            <SectionTitle>What she does</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {MOTION_PRESETS.map((p) => (
                <Chip
                  key={p.id}
                  active={motion === p.text}
                  onClick={() => {
                    setMotion(p.text);
                    setPresetId(p.id);
                  }}
                >
                  {p.label}
                  {p.best === 'motion' ? ' · best with 🕺' : ''}
                </Chip>
              ))}
            </div>
            {preset?.best === 'motion' && (
              <Notice kind="warn">
                <p className="font-medium">Best made with Copy Motion</p>
                <p className="mt-1 text-xs">{preset.why}</p>
                <p className="mt-1 text-xs">Copy Motion needs a short video of a real person doing this movement at normal speed. Animate Image will still try if you stay here.</p>
                <Button
                  className="mt-2"
                  onClick={() => {
                    setMotionMovement(preset.framing);
                    setMode('motion');
                  }}
                >
                  Switch to Copy Motion
                </Button>
              </Notice>
            )}
            <TextArea rows={3} value={motion} maxLength={MAX_MOTION_TEXT} onChange={(e) => setMotion(e.target.value)} hint="Describe movement, not her looks — her look comes from the photo." />
            {slow.length > 0 && (
              <p className="text-xs text-amber-300">
                “{slow.join('”, “')}” asks for slow movement — Wan already tends to move slowly, so this usually looks like slow motion. Say how fast instead, e.g. “at a normal walking pace”.
              </p>
            )}
            <SectionTitle>Camera</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CAMERA_LABELS) as CameraMove[]).map((c) => (
                <Chip key={c} active={camera === c} onClick={() => setCamera(c)}>
                  {CAMERA_LABELS[c].label}
                </Chip>
              ))}
            </div>
            <SectionTitle>Length</SectionTitle>
            <div className="flex gap-2">
              {DURATIONS_ANIMATE.map((s) => (
                <Chip key={s} active={seconds === s} onClick={() => setSeconds(s)}>
                  {s} s
                </Chip>
              ))}
            </div>
            <SectionTitle>Speed</SectionTitle>
            <div className={`grid gap-2 ${avail.experiments ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <Chip active={quality === 'fast'} onClick={() => setQuality('fast')} className="w-full">
                {avail.experiments ? 'Fast ✓' : 'Fast (recommended)'}
              </Chip>
              <Chip active={quality === 'quality'} onClick={() => setQuality('quality')} className="w-full">
                {avail.experiments ? 'Quality · test' : 'Quality (testing)'}
              </Chip>
              {avail.experiments && (
                <Chip active={quality === 'hybrid'} onClick={() => setQuality('hybrid')} className="w-full">
                  Hybrid · test
                </Chip>
              )}
            </div>
            {quality === 'fast' ? (
              <p className="text-xs text-ink-400">Recommended: best identity and cost in the motion test.</p>
            ) : (
              <p className="text-xs text-ink-400">
                Testing only. In the motion test, {quality === 'quality' ? 'Quality took 7× longer without more natural movement' : 'Hybrid restored speed on a jump but the picture fell apart'}; Fast is
                the recommended setting.
              </p>
            )}
          </Card>
        ) : (
          <Card className="space-y-3">
            <SectionTitle>Movement video</SectionTitle>
            <input ref={fileInput} type="file" accept="video/*" className="hidden" onChange={(e) => pickVideo(e.target.files?.[0])} />
            {drive ? (
              <>
                <video
                  key={drive.video.file}
                  src={fileUrl(drive.video.file)}
                  poster={fileUrl(drive.poster.file)}
                  controls
                  muted
                  playsInline
                  className="max-h-[40vh] w-full rounded-xl bg-black object-contain"
                />
                <p className="text-xs text-ink-400">
                  {drive.video.seconds.toFixed(1)} s · {drive.video.width}×{drive.video.height} (prepared for the GPU: 16 fps, no sound)
                </p>
                {drive.video.seconds > 1.5 && <Slider label="Start at (s)" value={start} onChange={setStart} min={0} max={maxStart} step={0.5} />}
                <Slider label="Length (s)" value={length} onChange={setLength} min={1} max={maxLength} step={0.5} hint={`max ${MAX_MOTION_SECONDS} s`} />
                <Button onClick={() => fileInput.current?.click()} disabled={upload !== null}>
                  Use a different video
                </Button>
              </>
            ) : (
              <Button className="w-full" onClick={() => fileInput.current?.click()} loading={upload !== null}>
                {upload === null ? '＋ Choose a video' : upload < 1 ? `Uploading ${Math.round(upload * 100)}%` : 'Preparing video…'}
              </Button>
            )}
            <p className="text-xs text-ink-400">
              Only the movement is copied: body pose, hands and expressions. The person in the video never appears in the result. Use videos of adults that you have the
              right to use. Up to 200 MB; the first 20 s are kept.
            </p>
            <p className="text-xs text-ink-400">
              Copy Motion follows the video’s real timing, so use a clip filmed at normal speed — don’t slow it down. Best for jumps, quick turns and fast movements where
              gravity and momentum matter.
            </p>
            <TextArea
              label="Scene (optional)"
              rows={2}
              value={scene}
              maxLength={MAX_MOTION_TEXT}
              onChange={(e) => setScene(e.target.value)}
              placeholder="e.g. she dances in a sunlit living room"
            />
          </Card>
        )}

        <Card className="space-y-3">
          <SectionTitle>Safe framing</SectionTitle>
          {mode === 'motion' ? (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(MOVEMENT_LABELS) as MovementKind[]).map((k) => (
                <Chip key={k} active={motionMovement === k} onClick={() => setMotionMovement(k)}>
                  {MOVEMENT_LABELS[k]}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-sm">Movement: {MOVEMENT_LABELS[movement]}</p>
          )}
          {movement === 'still' ? (
            <p className="text-xs text-ink-400">Small movements need no extra room.</p>
          ) : !framingUsable ? (
            <p className="text-xs text-amber-300">
              Not available: {mode === 'motion' && avail.motionEngine !== 'animate2' ? 'needs the Wan Animate 2 engine' : avail.safeFraming.missing.join('; ') || 'GPU server not ready'}.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Chip active={framing} onClick={() => setFramingChoice(true)} className="w-full">
                  On
                </Chip>
                <Chip active={!framing} onClick={() => setFramingChoice(false)} className="w-full">
                  Off
                </Chip>
              </div>
              <p className="text-xs text-ink-400">
                Adds only the room this movement needs above her head and around her body, so she stays in the frame. The new strip continues the photo’s own background; her
                pixels aren’t changed. Photos that already have room are left as they are. About 15 s more on the GPU.
              </p>
            </>
          )}
        </Card>

        <Card className="space-y-3">
          <SectionTitle>Camera stability</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <Chip active={!(lockUsable && lockCamera)} onClick={() => setLockCamera(false)} className="w-full">
              Natural camera
            </Chip>
            <Chip active={lockUsable && lockCamera} disabled={!lockUsable} onClick={() => setLockCamera(true)} className="w-full">
              🔒 Lock Camera
            </Chip>
          </div>
          {!lockAllowed ? (
            <p className="text-xs text-ink-400">Lock Camera works with “Still camera”. The camera move you chose is deliberate, so it isn’t removed.</p>
          ) : !avail.lockCamera.available ? (
            <p className="text-xs text-amber-300">Not available: {avail.lockCamera.missing.join('; ') || 'GPU server not ready'}.</p>
          ) : lockCamera ? (
            <p className="text-xs text-ink-400">
              Also makes a copy with the background held still, as if filmed from a tripod: only the camera’s drift is removed — her body, speed and timing are untouched,
              and nothing is cropped. You can switch between both versions afterwards. If it would cut off part of her, leave a visible edge or soften the picture, the
              copy is dropped and the natural video kept. A few seconds more.
            </p>
          ) : (
            <p className="text-xs text-ink-400">Keeps the camera movement the video was made with — a little natural drift can look more like real phone footage.</p>
          )}
        </Card>

        <Card className="space-y-3">
          <SectionTitle>Resolution</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <Chip active={resolution === '480p'} onClick={() => setResolution('480p')} className="w-full">
              480p (recommended)
            </Chip>
            <Chip active={resolution === '720p'} onClick={() => setResolution('720p')} className="w-full">
              720p (≈ 2× slower)
            </Chip>
          </div>
          <Collapsible title="More">
            <TextInput label="Seed" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^\d]/g, ''))} placeholder="random" />
          </Collapsible>
        </Card>

        <p className="text-xs text-ink-400">
          Engine: {engine}
          {framingUsable && framing ? ' + safe framing (photo checkpoint fills the added room)' : ''}
          {lockUsable && lockCamera ? ' + Lock Camera' : ''}
        </p>
        <Notice>
          About {minutes} min on the GPU (RTX 4090){mode === 'motion' && chunks.chunks > 1 ? `, made in ${chunks.chunks} parts` : ''}. Frames are checked against Sienna’s face
          (0.74): if any checked frame doesn’t match, the video goes to Needs Review. Videos are not redone automatically.
        </Notice>
        <Button variant="primary" className="w-full" disabled={!canRun} loading={busy} onClick={run}>
          {mode === 'animate' ? `🎬 Make ${seconds} s video` : `🕺 Copy ${length} s of motion`}
        </Button>
      </div>
    </div>
  );
}

function PhotoBadge({ rec }: { rec: GenerationRecord }) {
  const s = galleryState(rec);
  if (s === 'approved') return <Badge tone="ok">face verified</Badge>;
  if (s === 'approved_by_you') return <Badge>your approval · face unverified</Badge>;
  if (s === 'legacy') return <Badge>legacy · face not verified</Badge>;
  return <Badge tone="warn">face not verified</Badge>;
}
