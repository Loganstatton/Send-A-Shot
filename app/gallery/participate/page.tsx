import type { Metadata } from 'next';
import ParticipateForm from '@/components/gallery/ParticipateForm';

export const metadata: Metadata = { title: 'Become Part of the Work' };

export default function ParticipatePage() {
  return (
    <div className="max-w-[1000px] mx-auto px-5 sm:px-8 pt-32 sm:pt-40 pb-28">
      <header className="mb-16 max-w-2xl">
        <p className="g-label mb-4">Become Part of the Work</p>
        <h1 className="g-serif text-[clamp(2rem,5vw,3.2rem)] leading-tight mb-8">
          Some pieces are built from stories that aren&rsquo;t mine.
        </h1>
        <p className="text-lg leading-relaxed" style={{ color: 'var(--g-text-muted)' }}>
          Occasionally a drawing is shaped by someone else&rsquo;s experience &mdash; with their permission, and never without a
          personal conversation first. If you have something you&rsquo;d be willing to share, you can offer it here. Nothing
          is published or used automatically.
        </p>
      </header>

      <ParticipateForm />
    </div>
  );
}
