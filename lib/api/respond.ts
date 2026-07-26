/**
 * Shared Route Handler plumbing.
 *
 * The important behaviour here is the corpus-unavailable path: when the §3.2
 * integrity check has failed, every data endpoint must return 503 rather than
 * serving questions. There is deliberately no fallback that returns partial or
 * cached data — refusing to serve is the correct response to a suspect answer
 * key (I4, T6).
 */

import { NextResponse } from 'next/server';
import { CorpusUnavailableError } from '@/lib/db/client';

export interface ApiErrorBody {
  readonly error: string;
  readonly message: string;
  readonly problems?: readonly string[];
}

/** Cache immutable corpus responses hard; the data cannot change without a rebuild. */
const IMMUTABLE_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';

export function ok<T>(data: T, cache = true): NextResponse {
  return NextResponse.json(data, {
    headers: cache ? { 'Cache-Control': IMMUTABLE_CACHE } : { 'Cache-Control': 'no-store' },
  });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json<ApiErrorBody>({ error: 'bad_request', message }, { status: 400 });
}

export function notFound(message: string): NextResponse {
  return NextResponse.json<ApiErrorBody>({ error: 'not_found', message }, { status: 404 });
}

/**
 * Wrap a handler so a failed integrity check becomes a 503 with the diagnosis,
 * and anything else becomes a 500 without leaking internals to the client.
 */
export function withCorpus(handler: () => NextResponse): NextResponse {
  try {
    return handler();
  } catch (err) {
    if (err instanceof CorpusUnavailableError) {
      return NextResponse.json<ApiErrorBody>(
        {
          error: 'corpus_unavailable',
          message: err.message,
          problems: err.problems,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    console.error('[api] unhandled error', err);
    return NextResponse.json<ApiErrorBody>(
      { error: 'internal_error', message: 'The server could not complete the request.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

/** Repeated query params: `?subject=A&subject=B`, or a single comma-separated value. */
export function readList(params: URLSearchParams, key: string): string[] {
  const all = params.getAll(key);
  const flattened = all.flatMap((v) => v.split(',')).map((v) => v.trim()).filter((v) => v.length > 0);
  return [...new Set(flattened)];
}

export function readInt(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function readBool(params: URLSearchParams, key: string): boolean {
  const raw = params.get(key);
  return raw === '1' || raw === 'true';
}
