import './globals.css';
import Header from '@/components/Header';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Scout — Early Artist Discovery',
  description: 'Track emerging artists early, score their breakout potential, and manage outreach before anyone else notices them.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main className="container py-6">{children}</main>
        <footer className="container py-10 text-sm text-neutral-400">
          <div className="card">
            <p>
              <strong>Scout MVP:</strong> internal tool for tracking emerging, unsigned artists and
              scoring their breakout potential before they build a professional team. Data is stored
              locally in SQLite — this is a discovery/scoring tool, not a contract or payments system.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
