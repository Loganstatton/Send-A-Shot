// Minimal PNG encoder + placeholder "portrait" painter for mock mode.
// No native deps, so mock mode works anywhere Node runs.

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode 8-bit RGB pixels (row-major, 3 bytes per pixel) as PNG. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/**
 * Paint a seed-dependent placeholder: gradient "room" + soft head-and-shoulders
 * silhouette. Long edge capped at 512 px to keep mock mode fast.
 */
export function mockPortrait(w: number, h: number, seed: number) {
  const scale = Math.min(1, 512 / Math.max(w, h));
  const width = Math.max(16, Math.round(w * scale));
  const height = Math.max(16, Math.round(h * scale));
  const r = rand(seed);
  const top = [60 + r() * 120, 50 + r() * 100, 60 + r() * 120];
  const bottom = [20 + r() * 60, 20 + r() * 50, 30 + r() * 60];
  const skin = [222 + r() * 20, 170 + r() * 25, 145 + r() * 20];
  const hair = [120 + r() * 40, 55 + r() * 25, 30 + r() * 20];
  const cloth = [r() * 255, r() * 255, r() * 255];
  const cx = width * (0.42 + r() * 0.16);
  const headY = height * 0.36;
  const headR = Math.min(width, height) * 0.16;
  const rgb = new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    const t = y / height;
    for (let x = 0; x < width; x++) {
      let c = [top[0] * (1 - t) + bottom[0] * t, top[1] * (1 - t) + bottom[1] * t, top[2] * (1 - t) + bottom[2] * t];
      const dx = (x - cx) / headR;
      const dyHead = (y - headY) / (headR * 1.25);
      const hairD = Math.hypot(dx / 1.18, (y - headY + headR * 0.15) / (headR * 1.45));
      const headD = Math.hypot(dx, dyHead);
      const shoulderTop = headY + headR * 1.5;
      const shoulderHalf = headR * 2.6 + (y - shoulderTop) * 0.35;
      if (y > shoulderTop && Math.abs(x - cx) < shoulderHalf) c = cloth;
      else if (y > headY + headR * 0.9 && y <= shoulderTop && Math.abs(x - cx) < headR * 0.45) c = skin;
      if (hairD < 1 && headD >= 0.92) c = hair;
      if (headD < 0.92) c = skin;
      // hazard band top and bottom so mock output can never be mistaken for a real render
      if (y < height * 0.05 || y > height * 0.95) c = ((x + y) >> 3) % 2 ? [251, 191, 36] : [17, 17, 17];
      // subtle noise so it reads like a photo placeholder, not flat vector art
      const n = (r() - 0.5) * 10;
      const i = (y * width + x) * 3;
      rgb[i] = Math.max(0, Math.min(255, c[0] + n));
      rgb[i + 1] = Math.max(0, Math.min(255, c[1] + n));
      rgb[i + 2] = Math.max(0, Math.min(255, c[2] + n));
    }
  }
  return { width, height, rgb };
}

/** Read width/height from PNG or JPEG headers (best-effort). */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off < buf.length - 9) {
      if (buf[off] !== 0xff) return null;
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + len;
    }
  }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16);
    if (fmt === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  return null;
}
