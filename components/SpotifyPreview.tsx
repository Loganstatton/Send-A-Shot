// Spotify's own official embed widget — a real, licensed player Spotify
// hosts and serves, not audio we're re-hosting ourselves. Works for any
// artist with a Spotify presence, no per-artist audio file needed.
function parseSpotifyUrl(url: string): { type: 'track' | 'artist' | 'album'; id: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('spotify.com')) return null;
    const match = u.pathname.match(/\/(track|artist|album)\/([a-zA-Z0-9]+)/);
    if (!match) return null;
    return { type: match[1] as 'track' | 'artist' | 'album', id: match[2] };
  } catch {
    return null;
  }
}

// Prefers a specific song (a focused, compact player) over the artist's
// general profile (a taller widget listing their popular tracks) — a
// signature track is the closer match to "hear 20 seconds and get it."
export default function SpotifyPreview({ trackUrl, artistUrl }: { trackUrl?: string; artistUrl?: string }) {
  const parsed = (trackUrl ? parseSpotifyUrl(trackUrl) : null) ?? (artistUrl ? parseSpotifyUrl(artistUrl) : null);
  if (!parsed) return null;

  const height = parsed.type === 'track' ? 152 : 352;

  return (
    <iframe
      title="Spotify preview"
      src={`https://open.spotify.com/embed/${parsed.type}/${parsed.id}?utm_source=generator&theme=0`}
      width="100%"
      height={height}
      style={{ borderRadius: 12, border: 0 }}
      allowFullScreen
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
    />
  );
}
