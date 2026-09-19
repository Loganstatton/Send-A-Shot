import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://example.com';
  return {
    rules: [
      { userAgent: '*', allow: '/gallery', disallow: ['/gallery/admin', '/api'] },
      // Scout/NEXT aren't meant for public search indexing.
      { userAgent: '*', disallow: ['/next', '/admin', '/artists', '/discovery', '/screener', '/metrics', '/login', '/signup'] },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
