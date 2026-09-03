// The single, shared source of truth for "what image represents this
// artist as a person/act" — an avatar/profile-artwork resolver, used by
// every surface that shows one: Discover, Feed, Artist Detail, Watchlist,
// Portfolio, Leaderboard, Founding Believer, and public profile/share
// cards (components/next/ArtistCard.tsx, FeedCard.tsx, FeaturedArtist.tsx,
// RankedArtistList.tsx, FeedComposer.tsx, app/next/artists/[id]/page.tsx,
// the founding-believer share card, app/next/profile/[userId]/page.tsx).
//
// Pre-beta migration note: the audit that started this migration found
// each of those components had grown its own, inconsistent priority chain
// — ArtistCard/FeedCard tried photo_url then a YouTube video thumbnail;
// VideoBanner tried the thumbnail then photo_url; FeaturedArtist used
// photo_url only. A YouTube thumbnail is a frame of a specific video, not
// the artist's actual likeness — treating one as a stand-in profile photo
// was the actual bug, not just the inconsistency.
//
// The real filtering already happens server-side, once, at the security
// boundary: toPublicArtist() (lib/public-artist.ts) only lets a
// PublicArtist's photo_url through when its source is one this migration
// allows on Public NEXT — an artist-provided image (rights-confirmed),
// a properly licensed Wikimedia Commons image, an ordinary Scout-entered
// photo, or a legacy untagged one (grandfathered as-is, never reset). A
// LEGACY_DEEZER/LEGACY_SOUNDCHARTS-sourced photo — no established public
// reuse rights — never reaches a PublicArtist at all. So by the time any
// component asks this file "what's the avatar," the answer is already
// public-safe; this file exists so every surface asks it the SAME way,
// and so a future component can't reintroduce the video-thumbnail-as-
// avatar bug just by writing its own inline `photo_url || thumbnail`.
//
// getArtistAvatarUrl deliberately has no video-thumbnail branch at all.
// The featured-video area (components/next/VideoBanner.tsx, the featured-
// video hero on Artist Detail) is free to show a YouTube thumbnail in
// that one specific context — it's playback-adjacent artwork for a
// specific video the artist chose to feature, not a claim about what the
// artist looks like — but it must build that URL itself, not call this
// function to get it.
export function getArtistAvatarUrl(artist: { photo_url?: string | null }): string | undefined {
  return artist.photo_url || undefined;
}

export function hasArtistAvatarPhoto(artist: { photo_url?: string | null }): boolean {
  return Boolean(artist.photo_url);
}
