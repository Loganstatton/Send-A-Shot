'use client';
import { useEffect } from 'react';

// The one error boundary that fires when the ROOT layout itself throws —
// Next.js requires this to render its own <html>/<body> since there's no
// working layout left to nest inside. Deliberately plain inline styles,
// not Tailwind classes: if the app got here, something upstream (global
// CSS, the layout, a provider) may itself be broken, so this can't lean on
// any of that machinery.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: error.message, stack: error.stack, digest: error.digest, path: window.location.pathname }),
    }).catch(() => {});
  }, [error]);

  return (
    <html>
      <body style={{ margin: 0, background: '#14120e', color: '#f2ede4', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, minHeight: '100vh', textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#a89e8f', maxWidth: 420, margin: 0 }}>
            The app hit an unexpected error. It's been logged — try reloading.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ background: '#e8632a', color: '#14120e', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
