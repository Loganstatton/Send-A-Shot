import { characterPatchSchema } from '@/lib/schemas';
import { handle, json, parseBody } from '@/lib/server/http';
import { getCharacter, updateCharacter } from '@/lib/server/store';
import { findHardBlocks } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json(await getCharacter()));

export const PUT = handle(async (req: Request) => {
  const patch = await parseBody(req, characterPatchSchema);
  const text = [patch.appearanceTraits, patch.defaultRealismPrompt, patch.defaultCameraStyle, patch.triggerToken].filter(Boolean).join(' ');
  const blocked = findHardBlocks(text);
  if (blocked.length) return json({ error: `Profile rejected: “${blocked[0].term}” — ${blocked[0].reason}` }, 422);
  const merged = { ...(await getCharacter()), ...patch };
  if ((merged.faceReference || merged.secondaryReferences.length) && !merged.fictionalAttestation) {
    return json({ error: 'Confirm the reference images depict the fictional character (not a real person) before saving.' }, 422);
  }
  return json(await updateCharacter(patch));
});
