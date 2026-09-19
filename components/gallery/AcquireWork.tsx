'use client';
import { useState } from 'react';
import { Artwork } from '@/lib/gallery/types';
import { formatPrice } from '@/lib/gallery/format';

export default function AcquireWork({ artwork }: { artwork: Artwork }) {
  const [open, setOpen] = useState(false);

  const notForSale = artwork.availability === 'sold' || artwork.availability === 'private_collection';
  const editionSoldOut = artwork.edition_total != null && (artwork.edition_closed || artwork.edition_remaining === 0);

  return (
    <div>
      <div className="mb-6">
        {artwork.edition_total != null ? (
          <p className="g-label mb-2">
            Edition of {artwork.edition_total}
            {!editionSoldOut && artwork.edition_remaining != null && (
              <> &middot; {artwork.edition_remaining} / {artwork.edition_total} Remaining</>
            )}
          </p>
        ) : null}

        {artwork.price_display_mode === 'public' && artwork.price_cents != null && (
          <p className="g-serif text-2xl">{formatPrice(artwork.price_cents)}</p>
        )}
        {artwork.price_display_mode === 'upon_request' && (
          <p className="g-serif text-2xl italic" style={{ color: 'var(--g-text-muted)' }}>Price Upon Request</p>
        )}
      </div>

      {editionSoldOut ? (
        <span className="g-btn opacity-50 pointer-events-none">Edition Closed</span>
      ) : notForSale ? (
        <span className="g-btn opacity-50 pointer-events-none">Not Available</span>
      ) : (
        <button className="g-btn g-btn-solid" onClick={() => setOpen(true)}>Acquire This Work</button>
      )}

      {open && <InquiryModal artwork={artwork} onClose={() => setOpen(false)} />}
    </div>
  );
}

function InquiryModal({ artwork, onClose }: { artwork: Artwork; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [message, setMessage] = useState(`I'm interested in acquiring "${artwork.title}" (${artwork.year}).`);
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/gallery/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artwork_id: artwork.id, name, email, phone, country, message, website }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Something went wrong.');
      }
      setStatus('done');
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8" role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: 'oklch(0% 0 0 / 0.75)' }} onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto p-8 sm:p-12" style={{ background: 'var(--g-offwhite)', color: 'var(--g-black)' }}>
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-5 right-5 g-label"
          style={{ color: 'var(--g-black)' }}
        >
          Close
        </button>

        {status === 'done' ? (
          <div className="py-8">
            <p className="g-label mb-5" style={{ color: 'oklch(45% 0.01 60)' }}>Inquiry Received</p>
            <p className="g-serif text-2xl leading-relaxed mb-2">Thank you for your interest in this work.</p>
            <p className="leading-relaxed" style={{ color: 'oklch(35% 0.01 60)' }}>
              You will receive a personal response regarding availability and acquisition.
            </p>
          </div>
        ) : (
          <>
            <p className="g-label mb-3" style={{ color: 'oklch(45% 0.01 60)' }}>Acquisition Inquiry</p>
            <h2 className="g-serif text-2xl mb-8">{artwork.title}, {artwork.year}</h2>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="sr-only" aria-hidden="true">
                <label htmlFor="inquiry-website">Leave this field blank</label>
                <input id="inquiry-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>
              <Field label="Name"><input required className="g-input g-input-light" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Email"><input type="email" required className="g-input g-input-light" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Phone (optional)"><input className="g-input g-input-light" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              <Field label="Country"><input className="g-input g-input-light" value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
              <Field label="Message">
                <textarea required rows={4} className="g-input g-input-light resize-none" value={message} onChange={(e) => setMessage(e.target.value)} />
              </Field>

              {error && <p className="text-sm text-red-700">{error}</p>}

              <button type="submit" disabled={status === 'saving'} className="g-btn g-btn-ghost-light mt-4">
                {status === 'saving' ? 'Sending…' : 'Submit Inquiry'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="g-label block mb-1.5" style={{ color: 'oklch(45% 0.01 60)' }}>{label}</span>
      {children}
    </label>
  );
}
