import { z } from 'zod';
import { bodyReferenceProblem, BodyReference, MAX_BODY_REFS } from '@/lib/body-refs';
import { handle, HttpError, json, parseBody } from '@/lib/server/http';
import { experimentsEnabled, getCharacter, getRecord, updateCharacter } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

/** Approved Sienna body references (experimental Edit Outfit body protection). */
export const GET = handle(async () => json((await getCharacter()).bodyReferences ?? []));

/** Add a gallery image. Only images whose body came from the approved Sienna LoRA alone are accepted. */
export const POST = handle(async (req: Request) => {
  if (!experimentsEnabled()) throw new HttpError(403, 'Body references are experimental (SIENNA_EXPERIMENTAL is not "true").');
  const { recordId, imageIndex } = await parseBody(req, z.object({ recordId: z.string().min(1).max(64), imageIndex: z.number().int().min(0).max(7).default(0) }));
  const rec = await getRecord(recordId);
  if (!rec) throw new HttpError(404, 'Generation not found.');
  const problem = bodyReferenceProblem(rec, imageIndex);
  if (problem) throw new HttpError(422, `Can’t use this image as a body reference: ${problem}.`);
  const list = (await getCharacter()).bodyReferences ?? [];
  const image = rec.images[imageIndex];
  if (list.some((r) => r.image.id === image.id)) return json(list);
  if (list.length >= MAX_BODY_REFS) throw new HttpError(422, `At most ${MAX_BODY_REFS} body references — remove one first.`);
  const ref: BodyReference = { image, recordId: rec.id, lora: rec.lora!.name, addedAt: new Date().toISOString() };
  return json((await updateCharacter({ bodyReferences: [...list, ref] })).bodyReferences);
});

export const DELETE = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get('imageId') ?? '';
  const list = (await getCharacter()).bodyReferences ?? [];
  return json((await updateCharacter({ bodyReferences: list.filter((r) => r.image.id !== id) })).bodyReferences ?? []);
});
