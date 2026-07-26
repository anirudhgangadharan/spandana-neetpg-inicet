import type { NextConfig } from 'next';

/**
 * Content Security Policy.
 *
 * `script-src` must allow `'unsafe-inline'`. React 19 streams server-rendered
 * content to the browser inside inline `<script>self.__next_f.push(...)</script>`
 * blocks; blocking those does not degrade the page, it produces a BLANK one —
 * the shell paints and the content never arrives. An earlier `script-src 'self'`
 * did exactly that in production while every server-side check reported healthy,
 * which is a nasty failure mode: the HTML was correct and the browser refused to
 * execute the script that revealed it.
 *
 * What this costs is small here, because there is no injection vector to exploit:
 * all dataset text is reduced to plain text during the ETL and rendered through
 * ordinary React interpolation, and `dangerouslySetInnerHTML` is banned outright
 * and CI-enforced (§13.6). The app renders no user-supplied or remote markup.
 *
 * The clause that carries real weight is `connect-src 'self'` — a
 * browser-enforced second line behind invariant I2. Even a compromised
 * dependency cannot reach an external inference endpoint from this page.
 *
 * Upgrade path: Next.js supports per-request nonces set from middleware, which
 * would let `'unsafe-inline'` be dropped. That is the right long-term answer and
 * is deliberately not being attempted as a hotfix.
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
    ? "script-src 'self' 'unsafe-inline'"
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
