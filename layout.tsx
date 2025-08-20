import './globals.css';
import Header from '@/components/Header';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Send‑A‑Shot (Kit) – MVP',
  description: 'Send sealed mini “shot kits” legally. MVP demo.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main className="container py-6">{children}</main>
        <footer className="container py-10 text-sm text-neutral-400">
          <div className="card">
            <p><strong>Legal MVP:</strong> This demo only delivers <em>sealed</em> mini bottles and accessories (no open containers, no pouring by drivers). Age confirmation is a placeholder; production must use proper ID verification and comply with local laws.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
