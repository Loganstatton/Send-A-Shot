import { Fraunces, Inter } from 'next/font/google';
import Script from 'next/script';
import './gallery-theme.css';
import GalleryHeader from '@/components/gallery/GalleryHeader';
import GalleryFooter from '@/components/gallery/GalleryFooter';
import { ARTIST_NAME } from '@/lib/gallery/constants';
import type { Metadata } from 'next';

// Self-hosted via next/font, scoped to just /gallery/* — Scout/NEXT keep
// their own font stacks untouched (see globals.css / next-theme.css).
const serif = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-g-serif',
});
const sans = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-g-sans' });

export const metadata: Metadata = {
  title: {
    // `absolute` (not `default`) so this ignores the root layout's own
    // title.template ("%s · NEXT" — see app/layout.tsx, written for
    // Scout/NEXT) instead of inheriting it; `template` still applies to
    // any /gallery/* page below this that sets a plain string title.
    absolute: `${ARTIST_NAME} — Original Pencil & Charcoal Drawings`,
    default: `${ARTIST_NAME} — Original Pencil & Charcoal Drawings`,
    template: `%s — ${ARTIST_NAME}`,
  },
  description: 'Original works exploring what people feel but rarely say. Pencil and charcoal drawings, available for private acquisition.',
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  openGraph: {
    type: 'website',
    siteName: ARTIST_NAME,
    title: `${ARTIST_NAME} — Original Pencil & Charcoal Drawings`,
    description: 'Original works exploring what people feel but rarely say.',
  },
  twitter: { card: 'summary_large_image' },
};

// Entirely optional — unset by default, so the site ships with zero
// third-party analytics until a real measurement ID is provided.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export default function GalleryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`gallery-theme g-fullbleed g-cancel-root-padding ${serif.variable} ${sans.variable}`}>
      {GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="gallery-ga-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_ID}');`}
          </Script>
        </>
      )}
      <GalleryHeader artistName={ARTIST_NAME} />
      <main>{children}</main>
      <GalleryFooter artistName={ARTIST_NAME} />
    </div>
  );
}
