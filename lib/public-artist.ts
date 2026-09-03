// The single place an Artist row gets narrowed down to what Public NEXT is
// allowed to see. See PublicArtist's own comment in lib/types.ts for why
// this exists and what it deliberately leaves out.
import type { Artist, PublicArtist } from './types';

export function toPublicArtist(artist: Artist): PublicArtist {
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
    photo_url: artist.photo_url,
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
