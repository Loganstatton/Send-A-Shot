import path from 'path';

// Vercel's serverless functions run on a read-only filesystem except /tmp,
// and /tmp isn't guaranteed to persist between invocations/cold starts — so
// data written there can reset unexpectedly. Fine for kicking the tires;
// anywhere with a persistent disk (a VPS, Render, Railway, etc.) is a better
// fit for this app's local-SQLite-file design if you want data to stick.
export const DATA_DIR = process.env.VERCEL
  ? '/tmp/scout-data'
  : path.join(process.cwd(), 'data');
