import { ImageResponse } from 'next/og';
import { formatCents } from './format';
import { foundingBelieverSerial, getFoundingBelieverTier, type FoundingBelieverTierKey } from './founding-believer';
import type { FoundingBelieverRecord } from './types';

// Satori (next/og's renderer) doesn't support oklch() — the color function
// every other tier accent in next-theme.css is defined in — so these are
// hand-picked hex approximations of the same four tier accents, not a
// shared constant. Keep them in the same hue family as .holo-tier-* if
// those ever move.
const TIER_ACCENT_HEX: Record<FoundingBelieverTierKey, string> = {
  genesis: '#d4a342',
  founding: '#dda35c',
  early: '#c7bdb0',
  'first-wave': '#e8825f',
};

// The 1200x630 Founding Believer card, generated server-side from the
// permanent record itself — used both as the owner's downloadable image
// and as the preview image when an early-proof link is shared. holderName
// is shown on the public version, where the viewer isn't the holder.
export function renderProofCard({
  artist, score, priceCents, record, holderName,
}: {
  artist: { name: string };
  score: number;
  priceCents: number;
  record: FoundingBelieverRecord;
  holderName?: string;
}): ImageResponse {
  const trend = (now: number, then: number) => (now > then ? 'up' : now < then ? 'down' : 'flat');

  const tier = getFoundingBelieverTier(record.discovery_rank);
  const accent = TIER_ACCENT_HEX[tier.key];
  const serial = foundingBelieverSerial(artist.name, record.discovery_rank);
  const lockedDate = new Date(record.purchased_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const stats = [
    { label: 'NEXT SCORE', then: record.next_score.toFixed(0), now: score.toFixed(0), trend: trend(Number(score.toFixed(0)), Number(record.next_score.toFixed(0))) },
    { label: 'NEXT PRICE', then: formatCents(record.next_price_cents), now: formatCents(priceCents), trend: trend(priceCents, record.next_price_cents) },
  ];

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', width: 52, height: 52, borderRadius: 14, background: `${accent}29`, border: `2px solid ${accent}66`, alignItems: 'center', justifyContent: 'center' }}>
              {/* Same trophy glyph as the app's own Founding Believer icon elsewhere — an emoji here would silently render blank, since Satori has no emoji font loaded. */}
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth={2}>
                <path d="M8 21h8M12 17v4M17 5V3H7v2M17 5a5 5 0 0 1-5 5 5 5 0 0 1-5-5M17 5h2a2 2 0 0 1-2 4M7 5H5a2 2 0 0 0 2 4" />
              </svg>
            </div>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: accent }}>
              {tier.label}
            </div>
          </div>
          <div style={{ display: 'flex', fontSize: 15, letterSpacing: 1, color: '#6b6156' }}>{serial}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 800, lineHeight: 1.05 }}>{artist.name}</div>
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: accent }}>
            Backer #{record.discovery_rank} · Locked {lockedDate}
          </div>
          <div style={{ display: 'flex', fontSize: 18, color: '#8a8074' }}>
            {holderName ? `Backed by ${holderName} · recorded at the moment of backing, permanently` : 'This early-backer record is permanent — it stays attached even if sold.'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          {stats.map((stat) => (
            <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, padding: '18px 22px', borderRadius: 16, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', fontSize: 15, letterSpacing: 1.5, color: '#8a8074' }}>{stat.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ display: 'flex', fontSize: 19, color: '#8a8074' }}>{stat.then}</div>
                <div style={{ display: 'flex', fontSize: 17, color: '#8a8074' }}>→</div>
                <div style={{ display: 'flex', fontSize: 28, fontWeight: 800, color: stat.trend === 'up' ? '#5fd98a' : stat.trend === 'down' ? '#f27a6b' : '#f5efe6' }}>{stat.now}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, color: '#6b6156' }}>
          <div style={{ display: 'flex' }}>Edition · {tier.edition}</div>
          <div style={{ display: 'flex' }}>NEXT · virtual credits only, no real money</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
