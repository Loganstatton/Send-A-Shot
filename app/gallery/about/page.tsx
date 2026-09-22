import type { Metadata } from 'next';
import Link from 'next/link';
import Reveal from '@/components/gallery/Reveal';
import { listArtworks } from '@/lib/gallery/db';
import { ARTIST_NAME } from '@/lib/gallery/constants';

export const metadata: Metadata = { title: 'The Artist' };

export default function AboutPage() {
  const selected = listArtworks().slice(0, 3);

  return (
    <div>
      <section className="grid grid-cols-1 md:grid-cols-12 min-h-[80svh] md:min-h-screen pt-16 md:pt-0">
        <div className="md:col-span-7 relative min-h-[50vh] md:min-h-screen">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gallery-assets/placeholder/artist-portrait.svg" alt={`${ARTIST_NAME} at work in the studio`} className="w-full h-full object-cover" />
        </div>
        <div className="md:col-span-5 flex flex-col justify-center px-6 sm:px-14 py-16 md:py-0">
          <p className="g-label mb-6">The Artist</p>
          <h1 className="g-serif text-[clamp(2rem,4vw,3rem)] leading-tight">
            I draw the moments in Scripture that get skipped over — because they&rsquo;re too human to look at directly.
          </h1>
        </div>
      </section>

      <Section title="Philosophy">
        <p>A drawing doesn&rsquo;t ask to be liked the way a painting can. Graphite and charcoal don&rsquo;t flatter &mdash; they just sit with something difficult until it becomes true on the page.</p>
        <p>I&rsquo;m not interested in technical showmanship for its own sake. Every mark is in service of a single question: what did this moment actually feel like, stripped of everything Sunday school leaves out?</p>
      </Section>

      <Section title="Process" alt>
        <p>Each piece starts long before the pencil touches paper &mdash; with a passage I&rsquo;ve read a hundred times, until one line stops meaning what I thought it meant.</p>
        <p>The drawing itself is slow by necessity. Graphite and charcoal don&rsquo;t forgive an undecided hand, so most of the work happens in the thinking, the erasing, the returning to a single passage a dozen times before it&rsquo;s honest.</p>
      </Section>

      <Section title="Inspiration">
        <p>Every piece starts in Scripture &mdash; a specific verse, a specific person, a specific moment most retellings smooth over. Gethsemane. The centurion at the cross. The father who was already running before the son could finish his apology.</p>
        <p>I&rsquo;m drawn to the moments the text almost apologizes for including, because that&rsquo;s usually where the truest part of the story lives.</p>
      </Section>

      {selected.length > 0 && (
        <section className="py-24 sm:py-32 px-5 sm:px-8" style={{ background: 'var(--g-charcoal)' }}>
          <Reveal className="max-w-[1600px] mx-auto">
            <p className="g-label mb-10">Selected Works</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {selected.map((a) => (
                <Link key={a.id} href={`/gallery/works/${a.slug}`} className="block group">
                  {a.hero_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.hero_image_url} alt={a.title} loading="lazy" className="w-full aspect-[4/5] object-cover g-scale-hover" />
                  )}
                  <p className="g-serif mt-4">{a.title}</p>
                  <p className="g-label mt-1">{a.year}</p>
                </Link>
              ))}
            </div>
          </Reveal>
        </section>
      )}
    </div>
  );
}

function Section({ title, alt = false, children }: { title: string; alt?: boolean; children: React.ReactNode }) {
  return (
    <section className="py-24 sm:py-32 px-6" style={alt ? { background: 'var(--g-charcoal)' } : undefined}>
      <Reveal className="max-w-2xl mx-auto">
        <p className="g-label mb-8 text-center">{title}</p>
        <div className="space-y-8 g-serif italic text-[clamp(1.2rem,2.4vw,1.6rem)] leading-relaxed text-center">
          {children}
        </div>
      </Reveal>
    </section>
  );
}
