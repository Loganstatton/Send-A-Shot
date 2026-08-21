import './globals.css';
import Header from '@/components/Header';
import { getSessionUser } from '@/lib/auth';
import { getNewDiscoveryCandidateCount } from '@/lib/db';
import type { Metadata } from 'next';

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
      <body>
        <Header user={user} newCandidateCount={newCandidateCount} />
        <main className="container py-6">{children}</main>
      </body>
    </html>
  );
}
