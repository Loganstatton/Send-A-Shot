import Link from 'next/link';
import type { Metadata } from 'next';
import { listArtworks, listCollectorEmails, listInquiries, listSubmissions } from '@/lib/gallery/db';

export const metadata: Metadata = { title: 'Admin — Overview' };

export default function GalleryAdminOverview() {
  const artworks = listArtworks({ includeUnpublished: true, includeUnreleased: true });
  const inquiries = listInquiries();
  const submissions = listSubmissions();
  const collectors = listCollectorEmails();

  const stats = [
    { label: 'Published Works', value: artworks.filter((a) => a.is_published).length, href: '/gallery/admin/works' },
    { label: 'New Inquiries', value: inquiries.filter((i) => i.status === 'new').length, href: '/gallery/admin/inquiries' },
    { label: 'New Submissions', value: submissions.filter((s) => s.status === 'new').length, href: '/gallery/admin/submissions' },
    { label: 'Collector Emails', value: collectors.length, href: '/gallery/admin/collectors' },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="g-hairline-soft pt-6 block hover:opacity-80 transition-opacity">
            <p className="g-serif text-4xl mb-2">{s.value}</p>
            <p className="g-label">{s.label}</p>
          </Link>
        ))}
      </div>

      <Link href="/gallery/admin/works/new" className="g-btn g-btn-solid">+ Add New Work</Link>
    </div>
  );
}
