'use client';
import { useState } from 'react';
import { track } from '@/lib/track';

// Shares the public early-proof page — a link anyone can open, signed in or
// not, that previews as the card image in messaging apps and social posts.
// Uses the phone's share sheet where there is one, otherwise copies the link.
export default function CopyProofLinkButton({ recordId, artistName }: { recordId: number; artistName: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function share() {
    const url = `${window.location.origin}/next/proof/${recordId}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `I backed ${artistName} early on NEXT`, url });
        track('proof_link_shared', { recordId, method: 'share_sheet' });
        return;
      }
      await navigator.clipboard.writeText(url);
      track('proof_link_shared', { recordId, method: 'copy' });
      setState('copied');
      setTimeout(() => setState('idle'), 2500);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setState('error');
    }
  }

  return (
    <button type="button" onClick={share} className="next-btn-primary text-sm px-4 py-2.5 rounded-[10px]">
      {state === 'copied' ? '✓ Link copied' : state === 'error' ? 'Could not copy — try again' : 'Share proof link'}
    </button>
  );
}
