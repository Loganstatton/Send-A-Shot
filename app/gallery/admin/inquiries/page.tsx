import type { Metadata } from 'next';
import { listInquiries } from '@/lib/gallery/db';
import InquiryStatusSelect from '@/components/gallery/admin/InquiryStatusSelect';

export const metadata: Metadata = { title: 'Admin — Inquiries' };

export default function AdminInquiriesPage() {
  const inquiries = listInquiries();

  return (
    <div>
      <h2 className="g-serif text-xl mb-10">Inquiries ({inquiries.length})</h2>
      <div className="space-y-6">
        {inquiries.map((i) => (
          <div key={i.id} className="g-hairline-soft pt-6">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
              <div>
                <p className="g-serif text-lg">{i.name}</p>
                <p className="g-label mt-1">{new Date(i.created_at).toLocaleString()} {i.artwork_title_snapshot && `· ${i.artwork_title_snapshot}`}</p>
              </div>
              <InquiryStatusSelect id={i.id} status={i.status} />
            </div>
            <p className="text-sm mb-2">
              <a href={`mailto:${i.email}`} className="underline">{i.email}</a>
              {i.phone && ` · ${i.phone}`}
              {i.country && ` · ${i.country}`}
            </p>
            <p style={{ color: 'var(--g-text-muted)' }}>{i.message}</p>
          </div>
        ))}
        {inquiries.length === 0 && <p style={{ color: 'var(--g-text-muted)' }}>No inquiries yet.</p>}
      </div>
    </div>
  );
}
