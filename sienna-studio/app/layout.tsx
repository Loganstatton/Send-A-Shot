import type { Metadata, Viewport } from 'next';
import './globals.css';
import { BottomNav } from '@/components/BottomNav';
import { Toaster } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Sienna Studio',
  description: 'Consistent fictional-character image generation on a remote ComfyUI backend.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Sienna', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0b0f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-[100dvh]">
        <Toaster />
        <main className="mx-auto max-w-xl px-4">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
