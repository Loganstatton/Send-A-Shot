'use client';
import { useEffect, useState } from 'react';
import { timeAgo } from '@/lib/format';

// Timestamps in client components. The server renders in its own timezone
// and clock; the browser's differ (another timezone, or a minute later so
// "just now" became "1 minute ago"). Rendering the formatted text straight
// into the HTML makes React throw a hydration mismatch. These render the
// server's text, then re-format on the viewer's device after hydrating.

function useClientFormat(format: () => string, deps: unknown[]) {
  const [text, setText] = useState(format);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setText(format()), deps);
  return text;
}

export function TimeAgo({ iso }: { iso: string }) {
  const text = useClientFormat(() => timeAgo(iso), [iso]);
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}

export function LocalDateTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const text = useClientFormat(() => (dateOnly ? new Date(iso).toLocaleDateString() : new Date(iso).toLocaleString()), [iso, dateOnly]);
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
