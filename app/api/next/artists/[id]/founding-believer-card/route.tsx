import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { getFoundingBelieverRecord, getNextArtist } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Renders this Scout's own Founding Believer receipt as a downloadable/
// shareable 1200x630 PNG — real, generated server-side from the exact same
// permanent record the receipt page shows, not a mockup. Auth-gated like
// every other route touching this user's own data; a signed-out request
// (or a request for a record that isn't theirs) gets a 401/404, same as
// the page itself would via requireUser()/notFound().
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const row = getNextArtist(artistId);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const record = getFoundingBelieverRecord(user.id, artistId);
  if (!record) return NextResponse.json({ error: 'no founding believer record' }, { status: 404 });

  const { artist, score, priceCents } = row;
  const scoreUp = score >= record.next_score;
  const priceUp = priceCents >= record.next_price_cents;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 64,
          background: 'linear-gradient(135deg, #1a1006 0%, #120c08 55%, #0c0908 100%)',
          color: '#f5efe6',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', width: 52, height: 52, borderRadius: 14, background: 'rgba(212,163,66,0.16)', border: '2px solid rgba(212,163,66,0.4)', alignItems: 'center', justifyContent: 'center' }}>
            {/* Same trophy glyph as the app's own Founding Believer icon elsewhere — an emoji here would silently render blank, since Satori (next/og's renderer) has no emoji font loaded. */}
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#d4a342" strokeWidth={2}>
              <path d="M8 21h8M12 17v4M17 5V3H7v2M17 5a5 5 0 0 1-5 5 5 5 0 0 1-5-5M17 5h2a2 2 0 0 1-2 4M7 5H5a2 2 0 0 0 2 4" />
            </svg>
          </div>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#d4a342' }}>
            Founding Believer
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 800, lineHeight: 1.05 }}>{artist.name}</div>
          <div style={{ display: 'flex', fontSize: 26, color: '#c9beac' }}>
            You were backer #{record.discovery_rank} — {new Date(record.purchased_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20 }}>
          {[
            { label: 'NEXT SCORE', then: record.next_score.toFixed(0), now: score.toFixed(0), up: scoreUp },
            { label: 'NEXT PRICE', then: formatCents(record.next_price_cents), now: formatCents(priceCents), up: priceUp },
          ].map((stat) => (
            <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, padding: '20px 24px', borderRadius: 16, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', fontSize: 16, letterSpacing: 1.5, color: '#8a8074' }}>{stat.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <div style={{ display: 'flex', fontSize: 22, color: '#8a8074' }}>{stat.then}</div>
                <div style={{ display: 'flex', fontSize: 20, color: '#8a8074' }}>→</div>
                <div style={{ display: 'flex', fontSize: 34, fontWeight: 800, color: stat.up ? '#5fd98a' : '#f27a6b' }}>{stat.now}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', fontSize: 18, color: '#6b6156' }}>NEXT by Scout — paper trading, no real money changes hands.</div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
