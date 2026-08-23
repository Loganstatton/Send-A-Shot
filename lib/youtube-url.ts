// Pure string parsing only (no API calls, no env vars) — safe to import
// from client components, unlike lib/youtube.ts.

// Accepts a bare 11-char video ID or any common YouTube URL shape
// (watch?v=, youtu.be/, embed/, shorts/) and returns just the ID, or null
// if the input doesn't look like a YouTube video at all.
export function parseYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[\w-]{11}$/.test(vParam)) return vParam;
      const match = url.pathname.match(/\/(?:embed|shorts)\/([\w-]{11})/);
      if (match) return match[1];
    }
  } catch {
    // Not a URL at all — fall through to null.
  }
  return null;
}
