'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, fileUrl, useApi } from '@/lib/client/api';
import { interpretPrompt } from '@/lib/interpret';
import { PROMPT_FIELD_LABELS, type CharacterProfile, type GenerationRecord, type PromptFields, type StoredImage } from '@/lib/types';
import { CreateScreen } from './CreateScreen';
import { ImagePicker } from './ImagePicker';
import { JobCard } from './JobCard';
import { PhotoGpuCard } from './PhotoGpuCard';
import { Button, Card, Spinner, toast } from './ui';

const DRAFT_KEY = 'sienna.simple.draft';
const JOBS_KEY = 'sienna.simple.jobs';
const ADV_KEY = 'sienna.simple.advanced';

interface SettingsPayload {
  settings: { setupComplete: boolean; contentMode: 'sfw' | 'adult' };
  env?: { adultContentAllowed?: boolean };
}

const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

/**
 * The default Create screen: one description, an optional reference photo, Generate. The description is interpreted
 * on the server (lib/interpret.ts, previewed here) and run through the same pipeline as the advanced screen, which
 * stays available below.
 */
export function SimpleCreate() {
  const router = useRouter();
  const search = useSearchParams();
  const settingsQ = useApi<SettingsPayload>('/api/settings');
  const characterQ = useApi<CharacterProfile>('/api/character');
  const settings = settingsQ.data?.settings;
  const character = characterQ.data;

  const [prompt, setPrompt] = useState('');
  const [reference, setReference] = useState<StoredImage | null>(null);
  const [jobs, setJobs] = useState<GenerationRecord[]>([]);
  const [busy, setBusy] = useState(false);
  // the advanced screen opens by itself for links meant for it (?from= edit & regenerate, ?init= start image)
  const [advanced, setAdvanced] = useState(false);
  const [showUnderstood, setShowUnderstood] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (settings && !settings.setupComplete) router.replace('/setup');
  }, [settings, router]);

  useEffect(() => {
    const d = load<{ prompt: string; reference: StoredImage | null }>(DRAFT_KEY, { prompt: '', reference: null });
    setPrompt(d.prompt);
    setReference(d.reference);
    setAdvanced(!!(search.get('from') || search.get('init')) || load(ADV_KEY, false));
    const ids = load<string[]>(JOBS_KEY, []);
    Promise.all(ids.map((id) => api<GenerationRecord>(`/api/history/${id}`).catch(() => null))).then((r) => setJobs(r.filter(Boolean) as GenerationRecord[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => save(DRAFT_KEY, { prompt, reference }), [prompt, reference]);
  useEffect(() => save(JOBS_KEY, jobs.slice(0, 8).map((j) => j.id)), [jobs]);

  // the box grows with the description — nothing is ever cut off
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(180, el.scrollHeight + 2)}px`;
  }, [prompt, !!settings, !!character]); // also once the box exists (it isn't rendered while loading)

  const pending = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!pending.length) return;
    const t = setInterval(async () => {
      const ups = await Promise.all(pending.map((j) => api<GenerationRecord>(`/api/history/${j.id}/status`).catch(() => null)));
      setJobs((prev) => prev.map((j) => ups.find((u) => u?.id === j.id) ?? j));
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.map((j) => j.id + j.status).join(',')]);

  const understood = useMemo(
    () =>
      prompt.trim()
        ? interpretPrompt(prompt, { hasReference: !!reference, adultAllowed: settingsQ.data?.env?.adultContentAllowed, defaultMode: settings?.contentMode })
        : null,
    [prompt, reference, settings?.contentMode, settingsQ.data?.env?.adultContentAllowed],
  );

  async function generate(text = prompt, ref = reference) {
    if (!text.trim()) return toast('Describe the photo first', 'error');
    setBusy(true);
    try {
      // a clothing edit needs the photo GPU right away: while it boots the server answers 503, so keep asking
      let rec: GenerationRecord | null = null;
      for (let tries = 0; !rec; tries++) {
        try {
          rec = await api<GenerationRecord>('/api/create', { method: 'POST', json: { prompt: text, reference: ref } });
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 503) || tries >= 24) throw e;
          if (tries === 0) toast('Starting the photo GPU (1–3 minutes) — your edit will start by itself');
          await new Promise((r) => setTimeout(r, 15000));
        }
      }
      setJobs((prev) => [rec, ...prev].slice(0, 8));
      window.scrollTo({ top: document.getElementById('results')?.offsetTop ?? 0, behavior: 'smooth' });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!settings || !character) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-ink-400">
        <Spinner />
      </div>
    );
  }

  const face = character.faceReference;
  return (
    <div className="space-y-5 pb-28 pt-6">
      <header className="space-y-3 px-1">
        <div className="flex items-center gap-3">
          {face && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(face.file)} alt="" className="h-11 w-11 rounded-full object-cover ring-2 ring-accent/60" />
          )}
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-400">Character</p>
            <p className="font-medium">{character.name === 'Sienna' ? 'Sienna Brooks' : character.name}</p>
          </div>
        </div>
        <h1 className="text-2xl font-semibold leading-tight">What do you want Sienna to do?</h1>
      </header>

      <Card className="space-y-4">
        <textarea
          ref={box}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the photo — what she’s wearing, what she’s doing, where she is, the camera and the light. Write as much as you like."
          className="w-full resize-none rounded-xl bg-ink-800 p-4 text-[16px] leading-relaxed text-ink-100 outline-none ring-1 ring-ink-700 placeholder:text-ink-500 focus:ring-accent"
          rows={6}
          maxLength={8000}
          aria-label="Describe the photo"
        />
        <div className="flex items-start gap-4">
          <div className="w-28 shrink-0">
            <ImagePicker label="Reference photo" value={reference} onChange={setReference} aspect="aspect-[3/4]" />
          </div>
          <p className="pt-1 text-sm text-ink-400">
            Optional. Add a photo to recreate or edit it — say what to keep (“same pose”) and what to change (“new background”, “different outfit”).
          </p>
        </div>
        {understood && (
          <div>
            <button className="text-sm text-accent" onClick={() => setShowUnderstood((v) => !v)}>
              {showUnderstood ? 'Hide' : 'Show'} how this will be read
            </button>
            {showUnderstood && (
              <dl className="mt-2 space-y-1.5 rounded-xl bg-ink-800/60 p-3 text-sm">
                {(Object.keys(understood.fields) as (keyof PromptFields)[])
                  .filter((k) => understood.fields[k])
                  .map((k) => (
                    <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-2">
                      <dt className="text-ink-400">{k === 'avoid' ? 'Keep out' : PROMPT_FIELD_LABELS[k]}</dt>
                      <dd className="text-ink-200">{understood.fields[k]}</dd>
                    </div>
                  ))}
                {understood.notes.map((n, i) => (
                  <p key={i} className="pt-1 text-xs text-ink-400">
                    {n}
                  </p>
                ))}
              </dl>
            )}
          </div>
        )}
        <Button variant="primary" className="h-14 w-full text-lg" loading={busy} disabled={!prompt.trim()} onClick={() => generate()}>
          Generate
        </Button>
      </Card>

      <PhotoGpuCard />

      <section id="results" className="space-y-4">
        {jobs.map((job) => (
          <div key={job.id} className="space-y-2">
            <JobCard job={job} onDismiss={() => setJobs((p) => p.filter((j) => j.id !== job.id))} />
            {job.status !== 'queued' && job.status !== 'running' && (
              <div className="flex gap-2 px-1">
                <Button className="flex-1" onClick={() => generate(job.simple?.prompt ?? prompt, reference)} disabled={busy}>
                  ↻ Regenerate
                </Button>
                {job.images[0] && (
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setReference(job.images[0]);
                      if (job.simple?.prompt) setPrompt(job.simple.prompt);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                      toast('Added as the reference — describe what to change');
                    }}
                  >
                    ✎ Edit this photo
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      <details
        open={advanced}
        onToggle={(e) => {
          const open = (e.target as HTMLDetailsElement).open;
          setAdvanced(open);
          save(ADV_KEY, open);
        }}
        className="rounded-2xl bg-ink-900 ring-1 ring-ink-800"
      >
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between px-4 text-[15px] font-medium">
          Advanced settings
          <span className="text-xs font-normal text-ink-400">presets, fields, packs, pose, model, seed, sampling</span>
        </summary>
        {advanced && (
          <div className="px-1 pb-2">
            <CreateScreen />
          </div>
        )}
      </details>
    </div>
  );
}
