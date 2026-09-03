// The single place an Artist row gets narrowed down to what Public NEXT is
// allowed to see. See PublicArtist's own comment in lib/types.ts for why
// this exists and what it deliberately leaves out.
import type { Artist, PublicArtist } from './types';

export function toPublicArtist(artist: Artist): PublicArtist {
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
    isClaimed: artist.claimed_by_user_id != null,
  };
}
