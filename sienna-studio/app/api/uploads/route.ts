import { handle, HttpError, json } from '@/lib/server/http';
import { mimeFromBytes, storeImage } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024;

/** multipart/form-data: file=<image>, purpose=ref|up, label=<optional> */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new HttpError(400, 'Missing "file"');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'Image too large (max 25 MB)');
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = mimeFromBytes(bytes);
  if (!mime) {
    throw new HttpError(415, 'Unsupported image. Use PNG, JPEG or WebP (on iPhone, set Camera → Formats → Most Compatible, or share as JPEG).');
  }
  const purpose = form.get('purpose') === 'ref' ? 'ref' : 'up';
  const label = typeof form.get('label') === 'string' ? String(form.get('label')).slice(0, 200) : undefined;
  return json(await storeImage(bytes, mime, purpose, label));
});
