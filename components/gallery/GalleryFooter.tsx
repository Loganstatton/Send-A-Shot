import Link from 'next/link';
import PrivateReleasesForm from './PrivateReleasesForm';

export default function GalleryFooter({ artistName }: { artistName: string }) {
  return (
    <footer className="g-hairline mt-32" style={{ background: 'var(--g-black)' }}>
      <div className="max-w-[1600px] mx-auto px-5 sm:px-8 py-20 grid grid-cols-1 md:grid-cols-2 gap-14">
        <div>
          <p className="g-label mb-4">Private Releases</p>
          <p className="text-lg sm:text-xl leading-relaxed max-w-md mb-8" style={{ color: 'var(--g-text-muted)' }}>
            Receive early access to new originals, private releases, and upcoming collections.
          </p>
          <PrivateReleasesForm />
        </div>

        <div className="flex flex-col sm:flex-row md:justify-end gap-12 sm:gap-20">
          <div>
            <p className="g-label mb-4">Site</p>
            <ul className="space-y-2.5 text-sm" style={{ color: 'var(--g-text-muted)' }}>
              <li><Link href="/gallery/works" className="hover:text-[var(--g-text)] transition-colors">Works</Link></li>
              <li><Link href="/gallery/stories" className="hover:text-[var(--g-text)] transition-colors">Stories</Link></li>
              <li><Link href="/gallery/about" className="hover:text-[var(--g-text)] transition-colors">About</Link></li>
            </ul>
          </div>
          <div>
            <p className="g-label mb-4">Collectors</p>
            <ul className="space-y-2.5 text-sm" style={{ color: 'var(--g-text-muted)' }}>
              <li><Link href="/gallery/works?availability=available" className="hover:text-[var(--g-text)] transition-colors">Available Works</Link></li>
              <li><Link href="/gallery/participate" className="hover:text-[var(--g-text)] transition-colors">Become Part of the Work</Link></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="g-hairline-soft">
        <div className="max-w-[1600px] mx-auto px-5 sm:px-8 py-6 flex flex-col sm:flex-row justify-between gap-2 text-xs" style={{ color: 'var(--g-gray-faint)' }}>
          <span>&copy; {new Date().getFullYear()} {artistName}. All works reproduced by permission only.</span>
          <span>Original pencil &amp; charcoal drawings</span>
        </div>
      </div>
    </footer>
  );
}
