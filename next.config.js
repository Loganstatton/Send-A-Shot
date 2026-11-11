/** @type {import('next').NextConfig} */
const nextConfig = {
  // node-postgres is a server-only package with optional native bindings —
  // load it from node_modules at runtime instead of bundling it.
  experimental: {
    serverComponentsExternalPackages: ['pg'],
  },
};
module.exports = nextConfig;
