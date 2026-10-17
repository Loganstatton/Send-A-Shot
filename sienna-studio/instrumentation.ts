/** Server start: resume the on-demand GPU housekeeping (start-up checks, idle shutdown, timeouts) right away after a restart. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}
