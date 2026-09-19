import type { MetadataRoute } from 'next';
import { listArtworks, listStories } from '@/lib/gallery/db';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://example.com';

  const staticRoutes = ['/gallery', '/gallery/works', '/gallery/about', '/gallery/stories', '/gallery/private-releases', '/gallery/participate'];
  const artworkRoutes = listArtworks().map((a) => `/gallery/works/${a.slug}`);
  const storyRoutes = listStories().map((s) => `/gallery/stories/${s.slug}`);

  return [...staticRoutes, ...artworkRoutes, ...storyRoutes].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
  }));
}
