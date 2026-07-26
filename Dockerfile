# syntax=docker/dockerfile:1

# ============================================================================
# MedMCQA Practice â€” production image
#
# The 255 MB `corpus.sqlite` is baked into the image rather than mounted from a
# volume or fetched at boot. It is immutable build output: the answer key is
# fixed at build time (I1) and verified by checksum at startup (Â§3.2), so an
# image and the corpus it serves should be one indivisible artefact. A volume
# would let the two drift apart, which is precisely the failure mode the
# checksum exists to catch.
#
# Requires `pnpm data:build` to have been run first, so `data/build/` exists.
# ============================================================================

# ---- deps: install with native modules compiled for THIS platform ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 normally resolves a prebuilt binary; build tools are here so the
# image still builds if no prebuild matches the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


# ---- builder: compile the Next.js standalone server -----------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Opt into standalone output. It is off by default so that `pnpm start` keeps
# working on a development machine — `next start` does not support standalone.
ENV BUILD_STANDALONE=1
# `app/page.tsx` is force-dynamic, so the build never opens the corpus. It is
# copied in at the runner stage instead, keeping this layer independent of it.
RUN pnpm build


# ---- runner: minimal runtime ----------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Must bind 0.0.0.0, not localhost, or the platform's proxy cannot reach it.
ENV HOSTNAME=0.0.0.0

# The `node` user already exists at uid 1000 in the official images. Reusing it
# rather than creating a new uid keeps this image portable: Hugging Face Spaces
# expects the container to run as uid 1000.

# Standalone output carries its own trimmed node_modules.
#
# It also carries `better-sqlite3` complete with its compiled
# `build/Release/better_sqlite3.node` and its transitive deps, because
# `serverExternalPackages` makes Next trace rather than bundle it. Verified
# against a real build before writing this: the binary is at
#   node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/
#
# Do NOT add explicit `COPY node_modules/bindings` style lines here. Under pnpm
# those packages exist only inside `.pnpm/` and are symlinked, so copying them by
# top-level name fails the build â€” which is how the first version of this file
# broke. Trust the traced output.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# The corpus: read-only at runtime, owned by root so the app user cannot write to
# it even if something tried (I3 â€” the answer key is not writable from the app).
COPY --chown=root:root data/build/corpus.sqlite ./data/build/corpus.sqlite
COPY --chown=root:root data/build/manifest.json ./data/build/manifest.json
COPY --chown=root:root data/build/facets.json ./data/build/facets.json
RUN chmod 444 ./data/build/corpus.sqlite ./data/build/manifest.json

USER node
EXPOSE 3000

# Fails the container if the answer-key checksum does not verify, so an orchestrator
# refuses to route traffic to an instance serving a corpus it cannot vouch for.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
