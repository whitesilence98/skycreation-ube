import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // three.js ships ESM-only submodules; transpiling keeps dev SSR happy.
  transpilePackages: ['three'],
  images: {
    // Local MO2-derived previews are served by our own route handler.
    unoptimized: true,
  },
};

export default nextConfig;
