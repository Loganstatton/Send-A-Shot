import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import { getSessionUser } from '@/lib/auth';
import { getNewDiscoveryCandidateCount } from '@/lib/db';
import type { Metadata } from 'next';

// Scout's own typography — a plain, dense grotesk plus a mono for every
// number on screen, the "research terminal" half of the NEXT/Scout split.
// Scoped to the body's CSS vars, so /next's own next/font vars (set on its
// own nested wrapper in app/next/layout.tsx) still take precedence there.
const sans = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-scout-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-scout-mono' });

export const metadata: Metadata = {
  title: {
    default: 'NEXT — Back the next breakout artist',
    template: '%s · NEXT',
  },
  description: 'Paper-trade emerging artists with NEXT Credits. NEXT Score predicts breakout momentum; NEXT Price is what the community pays.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const isInternal = user?.role === 'internal' || user?.role === 'admin';
  const newCandidateCount = isInternal ? getNewDiscoveryCandidateCount() : 0;
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>
        <Header user={user} newCandidateCount={newCandidateCount} />
        <main className="container py-6">{children}</main>
      </body>
    </html>
  );
}
