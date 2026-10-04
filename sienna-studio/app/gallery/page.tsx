'use client';

import Link from 'next/link';
import { useState } from 'react';
import { fileUrl, useApi } from '@/lib/client/api';
import type { GenerationRecord } from '@/lib/types';
import { Badge, Chip, EmptyState, PageHeader, Spinner, cx } from '@/components/ui';

export default function GalleryPage() {
  const [filter, setFilter] = useState<'all' | 'fav' | 'issues'>('all');
  const { data, loading, error } = useApi<GenerationRecord[]>('/api/history?limit=500');

  const list = (data ?? []).filter((r) =>
    filter === 'fav' ? r.favorite : filter === 'issues' ? Object.values(r.review).includes('issue') : true,
  );

  return (
    <div className="pb-nav">
      <PageHeader title="Gallery" subtitle={data ? `${data.length} generations` : undefined} />
      <div className="mb-3 flex gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Chip>
        <Chip active={filter === 'fav'} onClick={() => setFilter('fav')}>
          ♥ Favorites
        </Chip>
        <Chip active={filter === 'issues'} onClick={() => setFilter('issues')}>
          ⚠ Flagged
        </Chip>
      </div>
      {loading && !data && (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      )}
      {error && <p className="text-red-300">{error}</p>}
      {data && list.length === 0 && (
        <EmptyState title={filter === 'all' ? 'No images yet' : 'Nothing here'}>
          {filter === 'all' && (
            <Link className="text-accent" href="/">
              Generate your first image →
            </Link>
          )}
        </EmptyState>
      )}
      <div className="grid grid-cols-2 gap-2">
        {list.map((r) => {
          const img = r.images[0];
          const issues = Object.values(r.review).filter((v) => v === 'issue').length;
          return (
            <Link key={r.id} href={`/gallery/${r.id}`} className="relative block aspect-[3/4] overflow-hidden rounded-xl bg-ink-800">
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(img.file)} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <div className={cx('flex h-full items-center justify-center text-xs', r.status === 'error' ? 'text-red-300' : 'text-ink-400')}>
                  {r.status === 'error' ? 'Failed' : r.status === 'done' ? 'No image' : 'In progress…'}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 text-[11px]">
                {r.favorite && <span className="text-accent">♥</span>}
                {issues > 0 && <Badge tone="warn">{issues} issue{issues > 1 ? 's' : ''}</Badge>}
                {r.images.length > 1 && <Badge>{r.images.length}</Badge>}
                <span className="ml-auto truncate text-ink-200">{r.presetName ?? 'Custom'}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
