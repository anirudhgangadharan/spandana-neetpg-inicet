import { describe, expect, it } from 'vitest';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { readBoundedJson } from '@/lib/api/jsonBody';

describe('shared API hardening', () => {
  it('accepts only the exact request origin', () => {
    expect(isSameOrigin(new Request('https://app.example/api/write', { headers: { origin: 'https://app.example' } }))).toBe(true);
    expect(isSameOrigin(new Request('https://app.example/api/write', { headers: { origin: 'https://evil.app.example' } }))).toBe(false);
    expect(isSameOrigin(new Request('https://app.example/api/write'))).toBe(false);
  });

  it('accepts the configured canonical origin behind a reverse proxy', () => {
    const previous = process.env.AUTH_URL;
    process.env.AUTH_URL = 'https://public.example';
    try {
      const proxied = new Request('http://internal-render-host:10000/api/write', {
        headers: { origin: 'https://public.example' },
      });
      expect(isSameOrigin(proxied)).toBe(true);
      expect(isSameOrigin(new Request(proxied, { headers: { origin: 'https://evil.example' } }))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.AUTH_URL;
      else process.env.AUTH_URL = previous;
    }
  });

  it('parses a bounded JSON object', async () => {
    const value = await readBoundedJson(new Request('https://app.example/api/write', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"ok":true}',
    }), 64);
    expect(value).toEqual({ ok: true });
  });

  it('rejects unsupported content types and oversized bodies', async () => {
    await expect(readBoundedJson(new Request('https://app.example/api/write', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    }), 64)).rejects.toMatchObject({ status: 415, name: 'JsonBodyError' });
    await expect(readBoundedJson(new Request('https://app.example/api/write', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(100) }),
    }), 32)).rejects.toMatchObject({ status: 413, name: 'JsonBodyError' });
  });
});
