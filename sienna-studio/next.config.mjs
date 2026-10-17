/** @type {import('next').NextConfig} */
const nextConfig = {
  // "standalone" produces a self-contained server in .next/standalone for Docker.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // ffmpeg-static locates its binary relative to its own folder, so it must not be bundled
  experimental: {
    // instrumentation.ts: resumes the on-demand video GPU housekeeping when the server starts
    instrumentationHook: true,
    serverComponentsExternalPackages: ['ffmpeg-static'],
    // keep the binary in the standalone (Docker) output too
    outputFileTracingIncludes: {
      '/api/**': ['./node_modules/ffmpeg-static/ffmpeg'],
      // the temporary video GPU downloads these from /api/video-gpu/kit
      '/api/video-gpu/**': ['./scripts/comfyui-bootstrap.sh', './scripts/comfy_nodes/sienna_nodes/**', './scripts/comfy_nodes/sienna_autostop/**'],
    },
  },
};

export default nextConfig;
