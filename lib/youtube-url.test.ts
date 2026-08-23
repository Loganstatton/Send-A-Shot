import { describe, expect, it } from 'vitest';
import { parseYoutubeVideoId } from './youtube-url';

describe('parseYoutubeVideoId', () => {
  it('accepts a bare video ID', () => {
    expect(parseYoutubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a watch URL', () => {
    expect(parseYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a watch URL with extra query params', () => {
    expect(parseYoutubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123')).toBe('dQw4w9WgXcQ');
  });

  it('parses a youtu.be short link', () => {
    expect(parseYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a youtu.be short link with a trailing query string', () => {
    expect(parseYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
  });

  it('parses an embed URL', () => {
    expect(parseYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a shorts URL', () => {
    expect(parseYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for a non-YouTube URL', () => {
    expect(parseYoutubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseYoutubeVideoId('not a url at all')).toBeNull();
    expect(parseYoutubeVideoId('')).toBeNull();
  });

  it('returns null for a YouTube channel/profile URL (no video)', () => {
    expect(parseYoutubeVideoId('https://www.youtube.com/@someartist')).toBeNull();
  });
});
