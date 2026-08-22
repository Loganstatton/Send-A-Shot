import { describe, expect, it } from 'vitest';
import { extractSpotifyArtistId } from './spotify';

describe('extractSpotifyArtistId', () => {
  it('extracts the id from a plain artist URL', () => {
    expect(extractSpotifyArtistId('https://open.spotify.com/artist/1uNFoZAHBGtllmzznpCI3s')).toBe('1uNFoZAHBGtllmzznpCI3s');
  });

  it('extracts the id when the URL has query params (e.g. a share link)', () => {
    expect(extractSpotifyArtistId('https://open.spotify.com/artist/1uNFoZAHBGtllmzznpCI3s?si=abc123')).toBe('1uNFoZAHBGtllmzznpCI3s');
  });

  it('returns null for a non-artist Spotify URL', () => {
    expect(extractSpotifyArtistId('https://open.spotify.com/track/1uNFoZAHBGtllmzznpCI3s')).toBeNull();
  });

  it('returns null for a non-Spotify URL', () => {
    expect(extractSpotifyArtistId('https://example.com/artist/1uNFoZAHBGtllmzznpCI3s')).toBeNull();
  });

  it('returns null for null/undefined/empty input', () => {
    expect(extractSpotifyArtistId(null)).toBeNull();
    expect(extractSpotifyArtistId(undefined)).toBeNull();
    expect(extractSpotifyArtistId('')).toBeNull();
  });
});
