/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode is disabled here to avoid GitHub request thrash in dev: the
  // viewer fires upstream patch fetches on mount, and double-invoked effects
  // would double those requests.
  reactStrictMode: false,
  reactCompiler: true,
  devIndicators: false,
  experimental: {
    cssChunking: 'strict',
  },
  // Resolve and transpile these so subpath exports (e.g. @pierre/trees/react)
  // resolve correctly when Next follows client-component imports from the
  // server, and so the worker chunk referenced by `new URL(...,
  // import.meta.url)` gets emitted.
  transpilePackages: ['@pierre/trees', '@pierre/diffs'],
};

export default nextConfig;
