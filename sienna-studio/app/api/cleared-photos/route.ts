import { handle, HttpError, json } from '@/lib/server/http';
import { addClearedPhoto, listClearedPhotos, mimeFromBytes, storeImage } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024;

/** Photo Swap's cleared photo library. */
export const GET = handle(async () => json(await listClearedPhotos()));

/** multipart/form-data: file=<image>, model=<her name or handle>, consent=true */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new HttpError(400, 'Missing "file"');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'Image too large (max 25 MB)');
  const model = typeof form.get('model') === 'string' ? String(form.get('model')) : '';
  const consent = form.get('consent') === 'true';
  if (!model.trim()) throw new HttpError(400, 'Enter the model’s name or handle.');
  if (!consent) throw new HttpError(400, 'Confirm that she agreed to her photos being used with Sienna’s face.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = mimeFromBytes(bytes);
  if (!mime) throw new HttpError(415, 'Unsupported image. Use PNG, JPEG or WebP.');
  const image = await storeImage(bytes, mime, 'ref', `Cleared photo: ${model.trim().slice(0, 80)}`);
  return json(await addClearedPhoto(image, model, consent), 201);
});
