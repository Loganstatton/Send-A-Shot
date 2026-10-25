import { describe, expect, it } from 'vitest';
import { imageSize } from './server/png';

// 37×23 WebP files made with Pillow: plain lossy (VP8) and lossless (VP8L), no VP8X header
const LOSSY = 'UklGRkYAAABXRUJQVlA4IDoAAABwAwCdASolABcAPm02l0ikIyIhJWgAgA2JZwB2APwAAFfvhuAA/q4X//5BcsLrka//+cSogk3mAAAA';
const LOSSLESS = 'UklGRh4AAABXRUJQVlA4TBEAAAAvJIAFAAdQsiJXpv+BiOh/AAA=';

describe('imageSize: WebP', () => {
  it('reads lossy and lossless WebP sizes, not only the extended format', () => {
    expect(imageSize(Buffer.from(LOSSY, 'base64'))).toEqual({ width: 37, height: 23 });
    expect(imageSize(Buffer.from(LOSSLESS, 'base64'))).toEqual({ width: 37, height: 23 });
  });
});
