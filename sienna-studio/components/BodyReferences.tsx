'use client';

import Link from 'next/link';
import { api, fileUrl, useApi } from '@/lib/client/api';
import { APPROVED_BODY_MODELS, BodyReference, MAX_BODY_REFS, MIN_BODY_REFS } from '@/lib/body-refs';
import { Badge, Button, Card, Notice, SectionTitle, toast } from './ui';

/**
 * Sienna page: the approved images that define her body for Edit Outfit's experimental body protection.
 * Added from the gallery (“Use as body reference”), only from approved-LoRA generations.
 */
export function BodyReferences() {
  const { data: settings } = useApi<{ env: { experiments?: boolean } }>('/api/settings');
  const { data: refs, setData } = useApi<BodyReference[]>('/api/character/body-references');
  if (!settings?.env.experiments) return null;
  const list = refs ?? [];

  async function remove(id: string) {
    try {
      setData(await api<BodyReference[]>(`/api/character/body-references?imageId=${encodeURIComponent(id)}`, { method: 'DELETE' }));
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  return (
    <div className="mt-2">
      <SectionTitle right={<Badge tone={list.length >= MIN_BODY_REFS ? 'ok' : 'warn'}>{list.length} / {MIN_BODY_REFS}–{MAX_BODY_REFS}</Badge>}>
        Body references · experimental
      </SectionTitle>
      <Card className="space-y-3">
        <p className="text-sm text-ink-200">
          Approved images of Sienna’s established body. Edit Outfit can show them to the editor so a new outfit is drawn on her body, not the
          clothing model’s, and the body check compares against the range they span — never one photo.
        </p>
        {list.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {list.map((r) => (
              <div key={r.image.id} className="w-[88px] text-center text-[11px] text-ink-400">
                <Link href={`/gallery/${r.recordId}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(r.image.file)} alt="Body reference" className="mb-1 h-28 w-[88px] rounded-lg bg-black object-cover" />
                </Link>
                <Button variant="ghost" className="h-8 min-h-0 w-full text-xs" onClick={() => remove(r.image.id)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-400">None yet.</p>
        )}
        {list.length < MIN_BODY_REFS && (
          <Notice kind="info">
            Add at least {MIN_BODY_REFS}: open a gallery image → <b>Use as body reference</b>. Best: full body, head to toe, standing, fitted or minimal
            clothing, plain pose. Only {APPROVED_BODY_MODELS.join(', ')} images made without an outfit reference, init image or Edit Outfit are accepted.
          </Notice>
        )}
      </Card>
    </div>
  );
}
