import type { Metadata } from 'next';
import Link from 'next/link';
import Reveal from '@/components/gallery/Reveal';
import { listStories } from '@/lib/gallery/db';

export const metadata: Metadata = { title: 'Stories' };

export default function StoriesPage() {
  const stories = listStories();

  return (
    <div className="max-w-[1000px] mx-auto px-5 sm:px-8 pt-32 sm:pt-40 pb-28">
      <header className="mb-20 max-w-2xl">
        <p className="g-label mb-4">Stories</p>
        <h1 className="g-serif text-[clamp(2rem,5vw,3.4rem)] leading-tight">Notes from the studio.</h1>
      </header>

      {stories.length === 0 ? (
        <p style={{ color: 'var(--g-text-muted)' }}>Nothing published yet &mdash; check back soon.</p>
      ) : (
        <div className="space-y-16">
          {stories.map((s) => (
            <Reveal key={s.id}>
              <Link href={`/gallery/stories/${s.slug}`} className="block g-hairline-soft pt-10">
                <p className="g-label mb-3">
                  {s.published_at ? new Date(s.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}
                </p>
                <h2 className="g-serif text-2xl sm:text-3xl mb-3">{s.title}</h2>
                {s.dek && <p style={{ color: 'var(--g-text-muted)' }}>{s.dek}</p>}
              </Link>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
