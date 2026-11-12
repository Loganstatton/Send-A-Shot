'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Row = { id: number; slug: string; title: string; published: boolean; itemCount: number };

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data;
}

export function CollectionsList({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await call('/api/collections', 'POST', { title, description });
      router.push(`/collections/${data.collection.id}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="card space-y-3">
        <h2 className="font-bold text-lg">New collection</h2>
        <div>
          <label className="label" htmlFor="collection-title">Title</label>
          <input id="collection-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="e.g. Bedroom pop to watch this spring" required />
        </div>
        <div>
          <label className="label" htmlFor="collection-description">Description</label>
          <textarea id="collection-description" className="input min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="One or two sentences on what ties these artists together." />
        </div>
        {error && <p role="alert" className="text-sm" style={{ color: 'var(--down)' }}>{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create (unpublished)'}</button>
      </form>
      <div className="card space-y-2">
        <h2 className="font-bold text-lg">Collections ({initial.length})</h2>
        {initial.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>None yet.</p>}
        <ul className="space-y-1.5">
          {initial.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3">
              <Link href={`/collections/${c.id}`} className="underline">{c.title}</Link>
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {c.itemCount} artists · {c.published ? <span style={{ color: 'var(--up)' }}>Published</span> : 'Draft'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type Item = { artistId: number; name: string; note: string };

export function CollectionEditor({
  collection, items, roster,
}: {
  collection: { id: number; slug: string; title: string; description: string; published: boolean };
  items: Item[];
  roster: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(collection.title);
  const [description, setDescription] = useState(collection.description);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inCollection = new Set(items.map((i) => i.artistId));
  const base = `/api/collections/${collection.id}`;

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setError(null);
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage(ok);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={(e) => { e.preventDefault(); run(() => call(base, 'PATCH', { title, description }), 'Saved.'); }} className="card space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-bold text-lg">Details</h2>
          <span className="text-sm">{collection.published ? <span style={{ color: 'var(--up)' }}>Published</span> : 'Draft — not visible on NEXT'}</span>
        </div>
        <div>
          <label className="label" htmlFor="edit-collection-title">Title</label>
          <input id="edit-collection-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} required />
        </div>
        <div>
          <label className="label" htmlFor="edit-collection-description">Description</label>
          <textarea id="edit-collection-description" className="input min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-primary">Save details</button>
          <button type="button" className="btn" onClick={() => run(() => call(base, 'PATCH', { published: !collection.published }), collection.published ? 'Unpublished.' : 'Published.')}>
            {collection.published ? 'Unpublish' : 'Publish'}
          </button>
          {collection.published && <Link className="btn" href={`/next/collections/${collection.slug}`}>View on NEXT</Link>}
          <button
            type="button"
            className="btn"
            style={{ color: 'var(--down)' }}
            onClick={() => { if (window.confirm('Delete this collection? This cannot be undone.')) call(base, 'DELETE').then(() => router.push('/collections')).catch((e) => setError(e.message)); }}
          >
            Delete
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Editorial only. Artists can&apos;t pay to be included; paid placement isn&apos;t supported and would need a visible
          &ldquo;Sponsored&rdquo; label.
        </p>
      </form>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Artists ({items.length})</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); if (pick) run(() => call(`${base}/items`, 'POST', { artistId: Number(pick), note }).then(() => { setPick(''); setNote(''); }), 'Added.'); }}
          className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_auto] gap-2 items-end"
        >
          <div>
            <label className="label" htmlFor="collection-add-artist">Artist</label>
            <select id="collection-add-artist" className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose an artist…</option>
              {roster.filter((a) => !inCollection.has(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="collection-add-note">Note (shown publicly)</label>
            <input id="collection-add-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Why they're here — one line" />
          </div>
          <button className="btn btn-primary" disabled={!pick}>Add</button>
        </form>
        {error && <p role="alert" className="text-sm" style={{ color: 'var(--down)' }}>{error}</p>}
        {message && <p role="status" className="text-sm" style={{ color: 'var(--up)' }}>{message}</p>}
        <ol className="space-y-2">
          {items.map((it, i) => (
            <li key={it.artistId} className="flex items-start gap-2 flex-wrap">
              <span className="num w-6 text-sm" style={{ color: 'var(--text-faint)' }}>{i + 1}.</span>
              <div className="flex-1 min-w-[200px]">
                <div className="font-semibold">{it.name}</div>
                <ItemNote base={base} item={it} onSaved={() => router.refresh()} />
              </div>
              <div className="flex gap-1">
                <button className="btn text-xs" aria-label={`Move ${it.name} up`} disabled={i === 0} onClick={() => run(() => call(`${base}/items`, 'PATCH', { artistId: it.artistId, move: 'up' }))}>↑</button>
                <button className="btn text-xs" aria-label={`Move ${it.name} down`} disabled={i === items.length - 1} onClick={() => run(() => call(`${base}/items`, 'PATCH', { artistId: it.artistId, move: 'down' }))}>↓</button>
                <button className="btn text-xs" aria-label={`Remove ${it.name}`} onClick={() => run(() => call(`${base}/items`, 'DELETE', { artistId: it.artistId }))}>Remove</button>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function ItemNote({ base, item, onSaved }: { base: string; item: Item; onSaved: () => void }) {
  const [value, setValue] = useState(item.note);
  const [saved, setSaved] = useState(false);
  const id = `collection-note-${item.artistId}`;
  return (
    <form
      onSubmit={async (e) => { e.preventDefault(); await call(`${base}/items`, 'PATCH', { artistId: item.artistId, note: value }); setSaved(true); onSaved(); }}
      className="flex gap-2 mt-1"
    >
      <label htmlFor={id} className="sr-only">Note for {item.name}</label>
      <input id={id} className="input text-sm" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} maxLength={200} placeholder="Note (optional)" />
      <button className="btn text-xs">{saved ? 'Saved' : 'Save'}</button>
    </form>
  );
}
