/** Server start: resume the on-demand video GPU housekeeping (idle shutdown, timeouts) right away after a restart. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.VIDEO_GPU === 'runpod') {
    const [{ startVideoGpuTimer }, { videoGpuHousekeeping }] = await Promise.all([import('./lib/server/video-gpu'), import('./lib/server/video')]);
    startVideoGpuTimer(videoGpuHousekeeping);
  }
}
