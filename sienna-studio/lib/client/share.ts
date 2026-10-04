'use client';

/**
 * Save/share an image. On iPhone, navigator.share with a File opens the
 * native share sheet which includes "Save Image" → Photos. Falls back to a
 * normal download (desktop) or opening the image (long-press → Save to Photos).
 */
export async function shareImage(url: string, filename: string, text?: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], ...(text ? { text } : {}) });
      return 'shared';
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = `${url}?download=${encodeURIComponent(filename)}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return 'downloaded';
}
