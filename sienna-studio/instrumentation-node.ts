// Node.js runtime only (imported by instrumentation.ts): starts the background housekeeping of the on-demand GPUs.
import { startPhotoGpuTimer } from './lib/server/photo-gpu';
import { startVideoGpuTimer } from './lib/server/video-gpu';

if (process.env.VIDEO_GPU === 'runpod') {
  import('./lib/server/video').then(({ videoGpuHousekeeping }) => startVideoGpuTimer(videoGpuHousekeeping));
}
if (process.env.PHOTO_GPU === 'runpod') {
  import('./lib/server/generate').then(({ photoGpuHousekeeping }) => startPhotoGpuTimer(photoGpuHousekeeping));
}
