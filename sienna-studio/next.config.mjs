/** @type {import('next').NextConfig} */
const nextConfig = {
  // "standalone" produces a self-contained server in .next/standalone for Docker.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
