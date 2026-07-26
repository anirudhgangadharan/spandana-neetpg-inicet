import type { NextConfig } from 'next';

/**
 * Content Security Policy.
 *
 * `'unsafe-inline'` is required for styles because Next.js injects inline
 * `<style>` for CSS Modules and the app sets a few inline `style` attributes for
 * dynamic widths. Scripts do NOT get `unsafe-inline` in production.
 *
 * `connect-src 'self'` matters here: it is a second, browser-enforced line of
 * defence behind invariant I2. Even if a dependency were compromised, the page
 * cannot reach an external inference endpoint.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  process.env.NODE_ENV === 'production'
    ? "script-src 'self'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  'upgrade-insecure-requests',
].join('; ');

/**
 * Standalone output only when a container build asks for it.
 *
 * It produces a self-contained server so the Docker image needs no node_modules
 * tree — but it also makes `next start` unsupported, because Next deliberately
 * leaves copying static assets into the bundle to the deployment. Making it
 * conditional keeps `pnpm build && pnpm start` working normally on a development
 * machine, while the Dockerfiles (which set BUILD_STANDALONE=1) get the lean
 * output they need.
 *
 * Spread rather than assigned: `exactOptionalPropertyTypes` rejects an explicit
 * `undefined` for an optional property.
 */
const standaloneOutput = process.env['BUILD_STANDALONE'] === '1' ? { output: 'standalone' as const } : {};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...standaloneOutput,

  /**
   * `better-sqlite3` is a native module: it must stay external to the server
   * bundle rather than being traced and rewritten by webpack/turbopack.
   */
  serverExternalPackages: ['better-sqlite3'],

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  experimental: {
    optimizePackageImports: ['@tanstack/react-virtual'],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
