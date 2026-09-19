import type { Metadata } from 'next';
import { listCollectorEmails } from '@/lib/gallery/db';

export const metadata: Metadata = { title: 'Admin — Collector List' };

export default function AdminCollectorsPage() {
  const emails = listCollectorEmails();

  return (
    <div>
      <h2 className="g-serif text-xl mb-10">Private Releases List ({emails.length})</h2>
      <div className="divide-y" style={{ borderColor: 'var(--g-line-soft)' }}>
        {emails.map((e) => (
          <div key={e.id} className="flex items-center justify-between py-3" style={{ borderTop: '1px solid var(--g-line-soft)' }}>
            <span>{e.email}</span>
            <span className="g-label">{new Date(e.created_at).toLocaleDateString()} &middot; {e.source}</span>
          </div>
        ))}
        {emails.length === 0 && <p className="py-6" style={{ color: 'var(--g-text-muted)' }}>No signups yet.</p>}
      </div>
    </div>
  );
}
