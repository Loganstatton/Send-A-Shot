import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStoryBySlug, listStories } from '@/lib/gallery/db';

export function generateStaticParams() {
  return listStories().map((s) => ({ slug: s.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const story = getStoryBySlug(params.slug);
  if (!story) return {};
  return { title: story.title, description: story.dek };
}

export default function StoryPage({ params }: { params: { slug: string } }) {
  const story = getStoryBySlug(params.slug);
  if (!story) notFound();

  const paragraphs = story.body.split(/\n{2,}/).filter(Boolean);

  return (
    <article className="max-w-[720px] mx-auto px-5 sm:px-8 pt-32 sm:pt-40 pb-28">
      <p className="g-label mb-4">
        {story.published_at ? new Date(story.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}
      </p>
      <h1 className="g-serif text-[clamp(2rem,5vw,3.2rem)] leading-tight mb-6">{story.title}</h1>
      {story.dek && <p className="text-xl mb-16" style={{ color: 'var(--g-text-muted)' }}>{story.dek}</p>}

      {story.cover_image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={story.cover_image_url} alt={story.title} className="w-full mb-16" />
      )}

      <div className="space-y-6 text-lg leading-relaxed" style={{ color: 'var(--g-offwhite-dim)' }}>
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>

      <div className="mt-20 g-hairline-soft pt-8">
        <Link href="/gallery/stories" className="g-label">&larr; All Stories</Link>
      </div>
    </article>
  );
}
