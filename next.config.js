/** @type {import('next').NextConfig} */

// Security headers for every response. Deliberately no script-src policy:
// Next.js inlines bootstrapping scripts, and a strict script CSP needs
// per-request nonces — the directives below are the ones that are safe to
// enforce today without breaking pages or the YouTube/Spotify embeds.
const securityHeaders = [
  // Nobody can put NEXT inside a frame on their own site (clickjacking).
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Browsers only honour this over HTTPS, so it's harmless locally.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig = {
  // node-postgres is a server-only package with optional native bindings —
  // load it from node_modules at runtime instead of bundling it.
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
module.exports = nextConfig;
