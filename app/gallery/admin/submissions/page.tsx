import type { Metadata } from 'next';
import { listSubmissions } from '@/lib/gallery/db';
import SubmissionStatusSelect from '@/components/gallery/admin/SubmissionStatusSelect';

export const metadata: Metadata = { title: 'Admin — Submissions' };

export default function AdminSubmissionsPage() {
  const submissions = listSubmissions();

  return (
    <div>
      <h2 className="g-serif text-xl mb-2">Become Part of the Work — Submissions ({submissions.length})</h2>
      <p className="text-sm mb-10" style={{ color: 'var(--g-text-muted)' }}>Never published automatically. Review here, then follow up personally.</p>
      <div className="space-y-6">
        {submissions.map((s) => (
          <div key={s.id} className="g-hairline-soft pt-6 grid grid-cols-1 sm:grid-cols-12 gap-6">
            {s.photo_url && (
              <div className="sm:col-span-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.photo_url} alt="" className="w-full aspect-square object-cover" />
              </div>
            )}
            <div className={s.photo_url ? 'sm:col-span-10' : 'sm:col-span-12'}>
              <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                <div>
                  <p className="g-serif text-lg">{s.name}</p>
                  <p className="g-label mt-1">{new Date(s.created_at).toLocaleString()}</p>
                </div>
                <SubmissionStatusSelect id={s.id} status={s.status} />
              </div>
              <p style={{ color: 'var(--g-text-muted)' }}>{s.story}</p>
            </div>
          </div>
        ))}
        {submissions.length === 0 && <p style={{ color: 'var(--g-text-muted)' }}>No submissions yet.</p>}
      </div>
    </div>
  );
}
