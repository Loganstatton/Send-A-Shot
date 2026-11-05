'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api, ApiError, useApi } from '@/lib/client/api';
import type { ClearedPhoto, GenerationRecord } from '@/lib/types';
import { Button, Card, EmptyState, Notice, PageHeader, SectionTitle, TextInput, toast } from '@/components/ui';

/**
 * Photo Swap: photos of models who agreed to their photos being used with Sienna's face (the cleared library), and
 * a swap of any of them. Only photos added here, with her name or handle and the consent tick, can be swapped.
 */
export default function SwapPage() {
  const router = useRouter();
  const photos = useApi<ClearedPhoto[]>('/api/cleared-photos');
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState('');
  const [consent, setConsent] = useState(false);
  const [adult, setAdult] = useState(false);
  const [adding, setAdding] = useState(false);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [waitNote, setWaitNote] = useState<string | null>(null);

  async function add() {
    if (!file || !model.trim() || !consent || !adult) return;
    setAdding(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('model', model.trim());
      form.append('consent', 'true');
      form.append('adult', 'true');
      await api('/api/cleared-photos', { method: 'POST', body: form });
      setFile(null);
      setModel('');
      setConsent(false);
      setAdult(false);
      if (fileRef.current) fileRef.current.value = '';
      photos.reload();
      toast('Added to the cleared library');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setAdding(false);
    }
  }

  async function remove(p: ClearedPhoto) {
    if (!confirm(`Remove this photo of ${p.model} from the cleared library?`)) return;
    try {
      await api(`/api/cleared-photos/${p.id}`, { method: 'DELETE' });
      photos.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function confirmAdult(p: ClearedPhoto) {
    if (!confirm(`Confirm that ${p.model} is 18 or older?`)) return;
    try {
      await api(`/api/cleared-photos/${p.id}`, { method: 'PATCH', json: { adult: true } });
      photos.reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  /** Starts a swap; while the photo GPU starts (503) it tries again every 20 s for up to 10 minutes. */
  async function swap(p: ClearedPhoto) {
    setSwapping(p.id);
    const until = Date.now() + 10 * 60_000;
    try {
      for (;;) {
        try {
          const rec = await api<GenerationRecord>('/api/photo-swap', { method: 'POST', json: { clearedId: p.id } });
          setWaitNote(null);
          router.push(`/gallery/${rec.id}`);
          return;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 503 || Date.now() > until) throw e;
          setWaitNote(e.message);
          await new Promise((r) => setTimeout(r, 20_000));
        }
      }
    } catch (e: any) {
      setWaitNote(null);
      toast(e.message, 'error');
    } finally {
      setSwapping(null);
    }
  }

  return (
    <div className="pb-nav">
      <PageHeader title="Photo Swap" subtitle="Sienna in place of the model, everything else kept" />
      <Card className="mb-4 space-y-3">
        <SectionTitle>Add a cleared photo</SectionTitle>
        <p className="text-sm text-ink-400">Only photos of models who agreed to their photos being used with Sienna’s face. Any other photo: use Copy Photo on the Create screen.</p>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-ink-300" />
        <TextInput label="Model’s name or handle" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. @mia.model" maxLength={120} />
        <label className="flex items-start gap-3 text-sm text-ink-200">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
          <span>She is 18 or older.</span>
        </label>
        <label className="flex items-start gap-3 text-sm text-ink-200">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
          <span>She agreed to her photos being used with Sienna’s face.</span>
        </label>
        <Button variant="primary" className="w-full" onClick={add} loading={adding} disabled={!file || !model.trim() || !consent || !adult}>
          Add to library
        </Button>
      </Card>
      {waitNote && (
        <div className="mb-4">
          <Notice>{waitNote} Trying again automatically…</Notice>
        </div>
      )}
      <SectionTitle>Cleared library</SectionTitle>
      {photos.data && !photos.data.length ? (
        <EmptyState title="No cleared photos yet">Add a photo above to swap it.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(photos.data ?? []).map((p) => (
            <Card key={p.id} className="space-y-2 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${p.image.file}`} alt={`Cleared photo of ${p.model}`} className="aspect-[3/4] w-full rounded-lg object-cover" />
              <div className="truncate text-sm font-medium">{p.model}</div>
              <div className="text-xs text-ink-400">Consent confirmed {new Date(p.consentedAt).toLocaleDateString()}</div>
              {p.adult ? (
                <Button variant="primary" className="w-full" onClick={() => swap(p)} loading={swapping === p.id} disabled={!!swapping}>
                  Swap
                </Button>
              ) : (
                <Button variant="primary" className="w-full" onClick={() => confirmAdult(p)}>
                  Confirm 18+
                </Button>
              )}
              <Button variant="ghost" className="w-full" onClick={() => remove(p)} disabled={!!swapping}>
                Remove
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
