import sharp from 'sharp';

/**
 * Copy Photo: a screenshot's solid app bar (the dark "Add comment…" bar under a story or reel) cut off before the photo
 * is copied. The overlay remover paints out the writing and buttons it recognises, but the bar itself stayed and was
 * kept, pixel for pixel, at the bottom of the copy (hot tub, 4 Nov). A bar is a run of rows at the top or bottom edge
 * that are almost all dark, with a hard edge against the photo above or below it.
 */
export const BAR_DARK = 70; // a pixel this dark (0-255 luma) is bar
export const BAR_ROW_SHARE = 0.75; // a row with this share of dark pixels is bar (the comment box and its writing are the rest)
export const BAR_MIN = 0.025; // a bar is at least this share of the height ...
export const BAR_MAX = 0.22; // ... and at most this
export const BAR_EDGE = 25; // the photo's row next to it is this much brighter on average (a dark night photo is not cut)

/** Rows to cut from the top and bottom of a greyscale picture (row-major luma). */
export function appBarRows(luma: Uint8Array, width: number, height: number): { top: number; bottom: number } {
  const rowDark = (y: number) => {
    let n = 0;
    for (let x = 0; x < width; x++) if (luma[y * width + x] < BAR_DARK) n++;
    return n / width;
  };
  const rowMean = (y: number) => {
    let s = 0;
    for (let x = 0; x < width; x++) s += luma[y * width + x];
    return s / width;
  };
  const run = (start: number, step: 1 | -1) => {
    let y = start;
    let misses = 0;
    let last = start - step;
    while (y >= 0 && y < height) {
      if (rowDark(y) >= BAR_ROW_SHARE) {
        last = y;
        misses = 0;
      } else if (++misses > 3) break; // a row or two of the comment box's writing
      y += step;
    }
    const size = step === 1 ? last + 1 : height - last;
    if (size < BAR_MIN * height || size > BAR_MAX * height) return 0;
    const inside = rowMean(last);
    const beyond = step === 1 ? last + 1 + 3 : last - 1 - 3; // a few rows into the photo, past any soft edge
    if (beyond < 0 || beyond >= height) return 0;
    return rowMean(beyond) - inside >= BAR_EDGE ? size : 0;
  };
  return { top: run(0, 1), bottom: run(height - 1, -1) };
}

/** The photo without its app bars, or null when it has none (or can't be read). */
export async function trimAppBars(bytes: Buffer): Promise<{ bytes: Buffer; mime: string; cut: { top: number; bottom: number } } | null> {
  try {
    const img = sharp(bytes).rotate();
    const { data, info } = await img.clone().removeAlpha().greyscale().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 1) return null;
    const cut = appBarRows(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height);
    if (!cut.top && !cut.bottom) return null;
    const out = await img.extract({ left: 0, top: cut.top, width: info.width, height: info.height - cut.top - cut.bottom }).png().toBuffer();
    return { bytes: out, mime: 'image/png', cut };
  } catch {
    return null;
  }
}
