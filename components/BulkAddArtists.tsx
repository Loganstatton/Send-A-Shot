'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// A broad, genre-spanning set of globally recognizable names — enough to
// give NEXT's Discover/Leaderboard some instantly familiar faces alongside
// real early finds. Editable before submitting; this is a starting point,
// not a fixed roster.
const FAMOUS_ARTISTS = [
  'Drake', 'The Weeknd', 'Beyoncé', 'Bad Bunny', 'Ariana Grande', 'Ed Sheeran', 'Rihanna',
  'Justin Bieber', 'Kanye West', 'Billie Eilish', 'Post Malone', 'Doja Cat', 'SZA',
  'Travis Scott', 'Olivia Rodrigo', 'Dua Lipa', 'Harry Styles', 'BTS', 'Bruno Mars',
  'Kendrick Lamar', 'Adele', 'Coldplay', 'Imagine Dragons', 'Eminem', 'Lady Gaga',
  'Katy Perry', 'Shakira', 'J Balvin', 'Karol G', 'Peso Pluma', 'Morgan Wallen',
  'Luke Combs', 'Zach Bryan', 'Nicki Minaj', 'Cardi B', '21 Savage', 'Future', 'Lil Baby',
  'Chris Brown', 'Usher', 'Sabrina Carpenter', 'Chappell Roan', 'Tyler, The Creator', 'Frank Ocean',
];

type RowStatus = 'pending' | 'working' | 'created' | 'skipped' | 'error';
type Row = { name: string; status: RowStatus; detail?: string };

const STATUS_LABEL: Record<RowStatus, string> = {
  pending: 'Queued', working: 'Working…', created: 'Added', skipped: 'Skipped', error: 'Failed',
};
const STATUS_COLOR: Record<RowStatus, string> = {
  pending: 'var(--text-faint)', working: 'var(--accent)', created: 'var(--up)',
  skipped: 'var(--text-faint)', error: 'var(--down)',
};

export default function BulkAddArtists() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  async function run() {
    const names = Array.from(new Set(text.split('\n').map((n) => n.trim()).filter(Boolean)));
    if (names.length === 0) return;
    setRunning(true);
    setRows(names.map((name) => ({ name, status: 'pending' })));

    // Skip anyone already on the roster (case-insensitive) — running this
    // list again later (adding a few more names) shouldn't create
    // duplicates of the ones already added.
    const existingRes = await fetch('/api/artists');
    const existing: { name: string }[] = existingRes.ok ? await existingRes.json() : [];
    const existingNames = new Set(existing.map((a) => a.name.trim().toLowerCase()));

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (existingNames.has(name.toLowerCase())) {
        setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, status: 'skipped', detail: 'already on the roster' } : r)));
        continue;
      }
      setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, status: 'working' } : r)));

      // Best-effort Soundcharts search-and-fill, same as the "Soundcharts"
      // box on the single Add Artist form — a search miss or a down API
      // just means this one artist gets created with a blank photo/stats
      // instead of blocking the rest of the batch.
      let soundchartsFields: Record<string, unknown> = {};
      try {
        const searchRes = await fetch(`/api/soundcharts/search?q=${encodeURIComponent(name)}`);
        if (searchRes.ok) {
          const hits: { uuid: string; name: string }[] = await searchRes.json();
          const normalized = name.trim().toLowerCase();
          const best = hits.find((h) => h.name.trim().toLowerCase() === normalized) ?? hits[0];
          if (best) {
            const dataRes = await fetch(`/api/soundcharts/artist/${encodeURIComponent(best.uuid)}`);
            if (dataRes.ok) {
              const data = await dataRes.json();
              soundchartsFields = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null && v !== ''));
            }
          }
        }
      } catch {
        // Soundcharts unreachable — fall through with no fields; POST below still creates the artist.
      }

      try {
        // POST /api/artists already does its own best-effort Deezer top-song
        // and YouTube featured-video lookups on create — nothing extra
        // needed here for those.
        const res = await fetch('/api/artists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            ...soundchartsFields,
            // Same neutral starting point every other new artist gets
            // (see ArtistForm / approveDiscoveryCandidate) — not a
            // fabricated per-category score, just a placeholder for a
            // Scout to adjust to their own judgment later.
            music_talent: 5,
            original_song_response: 5,
            brand_personality: 5,
            content_consistency: 5,
            commercial_potential: 5,
            professionalism: 5,
          }),
        });
        if (!res.ok) throw new Error('create failed');
        setRows((rs) => rs.map((r, idx) => (idx === i ? {
          ...r, status: 'created', detail: soundchartsFields.photo_url ? 'Soundcharts matched' : 'no Soundcharts match',
        } : r)));
      } catch {
        setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, status: 'error', detail: 'failed to create' } : r)));
      }
    }

    setRunning(false);
    router.refresh();
  }

  const doneCount = rows.filter((r) => r.status !== 'pending' && r.status !== 'working').length;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-lg">Bulk add artists</h2>
        <button type="button" className="btn text-sm" onClick={() => setText(FAMOUS_ARTISTS.join('\n'))} disabled={running}>
          Load famous artists preset
        </button>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        One artist name per line. Each one gets a real photo/genre/follower count from Soundcharts when it
        finds a match, plus an automatic top song (Deezer) and featured video (YouTube) — the same lookups
        Add Artist and the dashboard sync buttons already do, just run for the whole list at once. Names
        already on the roster are skipped, not duplicated.
      </p>
      <textarea
        className="input min-h-[160px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Drake\nThe Weeknd\nBeyoncé\n…'}
        disabled={running}
      />
      <button type="button" className="btn btn-primary" onClick={run} disabled={running || !text.trim()}>
        {running ? `Adding… (${doneCount}/${rows.length})` : 'Add these artists'}
      </button>
      {rows.length > 0 && (
        <div className="rounded-lg divide-y max-h-80 overflow-y-auto text-sm" style={{ border: '1px solid var(--border)' }}>
          {rows.map((r) => (
            <div key={r.name} className="flex items-center justify-between px-3 py-2" style={{ borderColor: 'var(--border)' }}>
              <span>{r.name}</span>
              <span className="num" style={{ color: STATUS_COLOR[r.status] }}>
                {STATUS_LABEL[r.status]}{r.detail ? ` — ${r.detail}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
