import './globals.css';
import Header from '@/components/Header';
import { getSessionUser } from '@/lib/auth';
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
  return (
    <html lang="en">
      <body>
        <Header user={user} />
        <main className="container py-6">{children}</main>
      </body>
    </html>
  );
}
