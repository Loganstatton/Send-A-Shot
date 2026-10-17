import 'server-only';
import { HttpError } from './http';
import { ensurePhotoGpu, photoGpuEnabled, photoGpuReady } from './photo-gpu';

/**
 * For photo tools that need ComfyUI right away (Edit Outfit, pose and outfit analysis): with the on-demand photo GPU
 * off, start it and ask the user to try again shortly instead of failing with a connection error.
 */
export async function wakePhotoGpu(): Promise<void> {
  if (!photoGpuEnabled() || (await photoGpuReady())) return;
  try {
    await ensurePhotoGpu();
  } catch (e: any) {
    throw new HttpError(e?.status === 402 ? 402 : 503, e.message);
  }
  throw new HttpError(503, 'The photo GPU is starting (usually 1–3 minutes). Try again in a moment — it stays on while you work and switches off by itself after a while without photos.');
}
