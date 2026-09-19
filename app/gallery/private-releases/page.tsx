import type { Metadata } from 'next';
import PrivateReleasesForm from '@/components/gallery/PrivateReleasesForm';

export const metadata: Metadata = { title: 'Private Releases' };

export default function PrivateReleasesPage() {
  return (
    <div className="min-h-[80svh] flex items-center justify-center px-6 pt-32 pb-28">
      <div className="max-w-lg text-center">
        <p className="g-label mb-6">Private Releases</p>
        <h1 className="g-serif text-[clamp(1.8rem,4vw,2.8rem)] leading-tight mb-8">
          Receive early access to new originals, private releases, and upcoming collections.
        </h1>
        <div className="flex justify-center">
          <PrivateReleasesForm source="private-releases-page" />
        </div>
      </div>
    </div>
  );
}
