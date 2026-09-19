import Link from 'next/link';
import type { Metadata } from 'next';
import { requireGalleryAdmin } from '@/lib/gallery/auth';

// noindex regardless of robots.txt (belt-and-suspenders — this is an
// authenticated admin area, never meant to appear in search results).
export const metadata: Metadata = { robots: { index: false, follow: false } };

const LINKS = [
  { href: '/gallery/admin', label: 'Overview' },
  { href: '/gallery/admin/works', label: 'Works' },
  { href: '/gallery/admin/stories', label: 'Stories' },
  { href: '/gallery/admin/inquiries', label: 'Inquiries' },
  { href: '/gallery/admin/submissions', label: 'Submissions' },
  { href: '/gallery/admin/collectors', label: 'Collector List' },
];

export default async function GalleryAdminLayout({ children }: { children: React.ReactNode }) {
  await requireGalleryAdmin();

  return (
    <div className="pt-28 pb-24 max-w-[1400px] mx-auto px-5 sm:px-8">
      <div className="flex items-center justify-between mb-10 flex-wrap gap-4">
        <div>
          <p className="g-label mb-2">Gallery Admin</p>
          <h1 className="g-serif text-2xl">Manage the collection</h1>
        </div>
        <Link href="/gallery" className="g-label opacity-70 hover:opacity-100">View Site &rarr;</Link>
      </div>
      <nav className="flex flex-wrap gap-2 mb-14 g-hairline-soft pt-6">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="g-tag hover:opacity-100">{l.label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
