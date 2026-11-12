import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import { getSessionUser } from '@/lib/auth';
import { getNewDiscoveryCandidateCount, getPendingArtistClaimCount } from '@/lib/db';
import type { Metadata } from 'next';

// Scout's own typography — a plain, dense grotesk plus a mono for every
// number on screen, the "research terminal" half of the NEXT/Scout split.
// Scoped to the body's CSS vars, so /next's own next/font vars (set on its
// own nested wrapper in app/next/layout.tsx) still take precedence there.
const sans = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-scout-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-scout-mono' });

export const metadata: Metadata = {
  // Makes relative preview-image paths (e.g. an early-proof card) absolute
  // in link previews, which messaging apps and social sites require.
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
  title: {
    default: "NEXT — Discover tomorrow's biggest artists",
    template: '%s · NEXT',
  },
  description: "Discover tomorrow's biggest artists and prove you found them first. Back emerging musicians with free virtual credits, compete with other music scouts, and earn a permanent record of your early calls.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const isInternal = user?.role === 'internal' || user?.role === 'admin';
  const newCandidateCount = isInternal ? await getNewDiscoveryCandidateCount() : 0;
  const pendingArtistClaimCount = isInternal ? await getPendingArtistClaimCount() : 0;
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>
        <Header user={user} newCandidateCount={newCandidateCount} pendingArtistClaimCount={pendingArtistClaimCount} />
        <main className="container py-6">{children}</main>
      </body>
    </html>
  );
}
