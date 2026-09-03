// The single place an Artist row gets narrowed down to what Public NEXT is
// allowed to see. See PublicArtist's own comment in lib/types.ts for why
// this exists and what it deliberately leaves out.
import type { Artist, PublicArtist, SourceType } from './types';

// Pre-beta migration: neither Deezer nor Soundcharts has established public
// reuse rights for the photos they return (that's the whole reason this
// migration exists) — a photo tagged with either of these never reaches a
// PublicArtist at all, regardless of how "real" the image otherwise looks.
// lib/artist-image.ts (the shared avatar resolver every public surface
// calls) then just falls back to the gradient/initial treatment.
const PHOTO_SOURCES_NEVER_PUBLIC = new Set<SourceType>(['LEGACY_DEEZER', 'LEGACY_SOUNDCHARTS']);

export function toPublicArtist(artist: Artist): PublicArtist {
  const photoIsPublicSafe = !artist.photo_source_type || !PHOTO_SOURCES_NEVER_PUBLIC.has(artist.photo_source_type);
  // Legally-required Commons attribution is the one piece of photo
  // provenance Public NEXT is allowed to see — see PublicArtist's own
  // comment. Anything sourced any other way (including the raw
  // photo_source_type label itself) never reaches this object.
  const commonsAttribution =
    artist.photo_source_type === 'WIKIMEDIA_COMMONS'
      ? { photo_attribution: artist.photo_attribution, photo_license: artist.photo_license, photo_license_url: artist.photo_license_url }
      : {};
  return {
    id: artist.id,
    created_at: artist.created_at,
    updated_at: artist.updated_at,
    name: artist.name,
    genre: artist.genre,
    location: artist.location,
    bio: artist.bio,
    photo_url: photoIsPublicSafe ? artist.photo_url : undefined,
    why_trending: artist.why_trending,
    featured_video_id: artist.featured_video_id,
    tiktok_url: artist.tiktok_url,
    instagram_url: artist.instagram_url,
    youtube_url: artist.youtube_url,
    spotify_url: artist.spotify_url,
    soundcloud_url: artist.soundcloud_url,
    website_url: artist.website_url,
    ...commonsAttribution,
    isClaimed: artist.claimed_by_user_id != null,
  };
}
