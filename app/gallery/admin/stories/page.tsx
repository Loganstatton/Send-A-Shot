import type { Metadata } from 'next';
import { listStories } from '@/lib/gallery/db';
import NewStoryForm from '@/components/gallery/admin/NewStoryForm';
import DeleteStoryButton from '@/components/gallery/admin/DeleteStoryButton';

export const metadata: Metadata = { title: 'Admin — Stories' };

export default function AdminStoriesPage() {
  const stories = listStories({ includeUnpublished: true });

  return (
    <div>
      <h2 className="g-serif text-xl mb-10">Stories ({stories.length})</h2>

      <div className="space-y-4 mb-16">
        {stories.map((s) => (
          <div key={s.id} className="flex items-start justify-between gap-4 g-hairline-soft pt-4">
            <div>
              <p className="g-serif">{s.title}</p>
              <p className="g-label mt-1">{s.published_at ? new Date(s.published_at).toLocaleDateString() : 'Unpublished'}</p>
            </div>
            <DeleteStoryButton id={s.id} />
          </div>
        ))}
        {stories.length === 0 && <p style={{ color: 'var(--g-text-muted)' }}>No stories yet.</p>}
      </div>

      <h3 className="g-serif text-lg mb-6">Publish a New Story</h3>
      <NewStoryForm />
    </div>
  );
}
