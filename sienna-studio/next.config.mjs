/** @type {import('next').NextConfig} */
const nextConfig = {
  // "standalone" produces a self-contained server in .next/standalone for Docker.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // ffmpeg-static locates its binary relative to its own folder, so it must not be bundled
  experimental: {
    serverComponentsExternalPackages: ['ffmpeg-static'],
    // keep the binary in the standalone (Docker) output too
    outputFileTracingIncludes: { '/api/**': ['./node_modules/ffmpeg-static/ffmpeg'] },
  },
};

export default nextConfig;
