import { handle } from '@/lib/server/http';
import { getConfigSnapshot, readImage } from '@/lib/server/store';
import type { ExportBundle } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Download settings, profile (incl. reference images), workflows and presets as one JSON file. */
export const GET = handle(async () => {
  const snap = await getConfigSnapshot();
  const files: Record<string, string> = {};
  const refs = [snap.character.faceReference, ...snap.character.secondaryReferences].filter(Boolean);
  for (const r of refs) {
    try {
      files[r!.file] = (await readImage(r!.file)).bytes.toString('base64');
    } catch {}
  }
  const bundle: ExportBundle = { app: 'sienna-studio', version: 1, exportedAt: new Date().toISOString(), ...snap, files };
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="sienna-studio-settings-${date}.json"`,
      'Cache-Control': 'no-store',
    },
  });
});
