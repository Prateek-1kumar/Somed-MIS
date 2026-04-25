import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  reactStrictMode: true,
  turbopack: {},
  // @duckdb/duckdb-wasm ships large WASM binaries and loads them via
  // computed paths at runtime — Next's bundler must not inline it.
  // @vercel/blob uses undici (node-only) and must also stay external.
  serverExternalPackages: [
    '@duckdb/duckdb-wasm',
    '@vercel/blob',
  ],
};

export default nextConfig;
