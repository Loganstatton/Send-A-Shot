/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 ships a native .node binary — keep it out of the webpack
  // bundle (Next tries to parse it as JS otherwise, which breaks the build).
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};
module.exports = nextConfig;
