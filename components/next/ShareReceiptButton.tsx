'use client';
import { useEffect, useState } from 'react';

// Downloads always work via a plain <a download> link — no JS needed for
// that path. The Web Share API path is progressive enhancement on top:
// where the browser supports sharing files (most mobile browsers; many
// desktop browsers don't), "Share" hands the actual generated PNG to
// whatever the OS share sheet offers (Messages, X, etc.) instead of just a
// link, so the receipt looks right wherever it lands.
function canShareFilesNow(): boolean {
  if (typeof navigator === 'undefined' || !('canShare' in navigator)) return false;
  try {
    return navigator.canShare?.({ files: [new File([''], 'probe.png', { type: 'image/png' })] }) ?? false;
  } catch {
    return false;
  }
}

export default function ShareReceiptButton({ artistId, artistName }: { artistId: number; artistName: string }) {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardUrl = `/api/next/artists/${artistId}/founding-believer-card`;
  // Starts false and flips after mount, deliberately — computing this
  // straight from `navigator` during render would make the server's HTML
  // (no `navigator`, always false) disagree with the client's very first
  // render (true on a capable browser), which is exactly what triggers a
  // React hydration mismatch. Checking in an effect keeps the first client
  // render identical to the server's, then reveals the button right after.
  const [canShareFiles, setCanShareFiles] = useState(false);
  useEffect(() => setCanShareFiles(canShareFilesNow()), []);

  async function share() {
    setSharing(true);
    setError(null);
    try {
      const res = await fetch(cardUrl);
      if (!res.ok) throw new Error('Could not generate the card.');
      const blob = await res.blob();
      const file = new File([blob], `${artistName.replace(/\s+/g, '-').toLowerCase()}-founding-believer.png`, { type: 'image/png' });
      await navigator.share({
        files: [file],
        title: `I was a Founding Believer in ${artistName}`,
        text: `I backed ${artistName} early on NEXT.`,
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError('Could not share — try downloading instead.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <a href={cardUrl} download={`${artistName.replace(/\s+/g, '-').toLowerCase()}-founding-believer.png`} className="next-btn-ghost text-sm px-4 py-2.5 rounded-[10px]">
        Download card
      </a>
      {canShareFiles && (
        <button type="button" onClick={share} disabled={sharing} className="next-btn-primary text-sm px-4 py-2.5 rounded-[10px]">
          {sharing ? 'Sharing…' : 'Share'}
        </button>
      )}
      {error && <span className="text-xs" style={{ color: 'var(--down)' }}>{error}</span>}
    </div>
  );
}
