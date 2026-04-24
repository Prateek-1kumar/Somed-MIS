import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  reactStrictMode: true,
  turbopack: {},
  // @duckdb/node-api loads native prebuilt binaries per platform via a
  // dynamic require(). Next's bundler cannot statically resolve those, and
  // we don't want it to — the package is server-only and should run from
  // node_modules at runtime, not be bundled. Same for @vercel/blob which
  // uses undici (node-only).
  serverExternalPackages: [
    '@duckdb/node-api',
    '@duckdb/node-bindings',
    '@vercel/blob',
  ],
};

export default nextConfig;
